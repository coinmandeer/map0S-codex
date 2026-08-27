import assert from "node:assert/strict";
import { test } from "node:test";
import { __testing } from "./wikivoyage.js";
import { leadParagraph, parseTemplates, splitSections, stripMarkup } from "./wikitext.js";

const { sectionsFrom } = __testing;

const ARTICLE = `
Plzeň is a city in [[West Bohemia]], best known for the beer named after it. It has about
170,000 inhabitants. {{quickbar|population=170000}}

== See ==
{{see
| name=Great Synagogue | alt=Velká synagoga | lat=49.7466 | long=13.3736
| address=Sady Pětatřicátníků 11 | hours=Apr–Oct 10:00–18:00 | price=90 Kč
| content=The second largest synagogue in Europe, with a {{km|2}} walk from the centre.
}}
{{see|name=Cathedral of St. Bartholomew|lat=49.7475|long=13.3776|content=Tallest church tower in the country.}}
{{listing|type=see|name=Pilsen Historical Underground|lat=49.7480|long=13.3785|content=Medieval cellars.}}

== Do ==
{{do|name=Pilsner Urquell Brewery Tour|lat=49.7477|long=13.3888|url=https://www.prazdrojvisit.cz|content=Includes unfiltered beer from an oak barrel.}}

== Eat ==
{{eat|name=Na Spilce|lat=49.7476|long=13.3880|price=200–400 Kč|content=Brewery restaurant.}}

== Get around ==
Trams and trolleybuses run everywhere.
`;

test("nested templates do not truncate a listing", () => {
  const templates = parseTemplates(ARTICLE);
  const synagogue = templates.find((t) => t.params.name === "Great Synagogue");
  assert.ok(synagogue);
  // The `{{km|2}}` inside the description must not end the listing early.
  assert.match(synagogue.params.content!, /oak|walk from the centre/);
  assert.equal(synagogue.params.price, "90 Kč");
});

test("an article becomes sections a panel can render", () => {
  const sections = sectionsFrom(ARTICLE, "en", "Plzeň");
  const ids = sections.map((s) => s.id);

  assert.deepEqual(ids, ["understand", "see", "do", "eat"]);
  assert.match(sections[0]!.intro!, /West Bohemia/);
  // The lead is prose, so its wiki links are gone but their labels stay.
  assert.ok(!sections[0]!.intro!.includes("[["));

  const see = sections.find((s) => s.id === "see")!;
  // Both the shorthand `{{see}}` and the generic `{{listing|type=see}}` land in the same section.
  assert.equal(see.items.length, 3);
  assert.deepEqual(
    see.items.map((i) => i.name),
    ["Great Synagogue", "Cathedral of St. Bartholomew", "Pilsen Historical Underground"]
  );

  const synagogue = see.items[0]!;
  assert.equal(synagogue.lat, 49.7466);
  assert.equal(synagogue.lng, 13.3736);
  assert.equal(synagogue.hours, "Apr–Oct 10:00–18:00");
  assert.equal(synagogue.sourceRef, "wikivoyage:en:Plzeň#Great Synagogue");

  const eat = sections.find((s) => s.id === "eat")!;
  assert.equal(eat.items[0]!.price, "200–400 Kč");
});

test("sections without listings are left out rather than shown empty", () => {
  const sections = sectionsFrom(ARTICLE, "en", "Plzeň");
  assert.ok(!sections.some((s) => s.title === "Get around"));
});

test("a listing without a name is not an entry", () => {
  const sections = sectionsFrom(
    "== See ==\n{{see|lat=50|long=14|content=Something unnamed.}}\n",
    "en",
    "X"
  );
  assert.deepEqual(sections, []);
});

test("markup is stripped without eating the words", () => {
  assert.equal(stripMarkup("A [[Prague|city]] with '''beer'''"), "A city with beer");
  assert.equal(stripMarkup("See [https://example.com the site]"), "See the site");
  assert.equal(stripMarkup("Text<ref>a citation</ref> after"), "Text after");
});

test("headings split the article body", () => {
  const sections = splitSections(ARTICLE);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["See", "Do", "Eat", "Get around"]
  );
});

test("the lead stops at the first heading", () => {
  const lead = leadParagraph(ARTICLE);
  assert.match(lead, /Plzeň is a city/);
  assert.ok(!lead.includes("Synagogue"));
});
