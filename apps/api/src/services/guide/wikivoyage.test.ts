import assert from "node:assert/strict";
import { test } from "node:test";
import { __testing, createWikivoyageSource } from "./wikivoyage.js";
import type { fetchJson } from "../../utils/upstream.js";
import { leadParagraph, parseTemplates, splitSections, stripMarkup } from "./wikitext.js";

const { sectionsFrom } = __testing;

function reader(
  load: (url: string, options: Parameters<typeof fetchJson>[1]) => unknown
): typeof fetchJson {
  return async <T>(url: string, options: Parameters<typeof fetchJson>[1]) =>
    (await load(url, options)) as T;
}

test("Prague uses its entity's article instead of the nearby historical Czechoslovakia article", async () => {
  const urls: string[] = [];
  const signal = new AbortController().signal;
  const source = createWikivoyageSource(
    reader((url, options) => {
      urls.push(url);
      assert.equal(options.signal, signal);
      if (url.includes("wbgetentities"))
        return { entities: { Q1085: { sitelinks: { enwikivoyage: { title: "Prague" } } } } };
      if (url.includes("action=parse")) {
        assert.equal(new URL(url).searchParams.get("page"), "Prague");
        return { parse: { wikitext: "Prague is the capital of Czechia." } };
      }
      return { query: { geosearch: [{ title: "Czechoslovakia", pageid: 1, dist: 0 }] } };
    })
  );
  const guide = await source.fetchGuide(
    { name: "Praha", wikidataId: "Q1085", lang: "cs", bbox: [14, 49, 15, 51] },
    signal
  );
  assert.equal(guide?.area, "Prague");
  assert.match(guide?.sections[0]?.intro ?? "", /capital of Czechia/);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => !url.includes("geosearch")));
});

test("named areas follow explicit redirects but never fall back to a different nearby article", async () => {
  let exists = true;
  const urls: string[] = [];
  const source = createWikivoyageSource(
    reader((url) => {
      urls.push(url);
      if (url.includes("action=parse")) return { parse: { wikitext: "Prague is a city." } };
      assert.equal(new URL(url).searchParams.get("titles"), "Praha");
      return { query: { pages: [{ title: "Prague", ...(exists ? {} : { missing: true }) }] } };
    })
  );
  const area = {
    name: "Praha",
    lang: "en",
    bbox: [14, 49, 15, 51] as [number, number, number, number]
  };
  assert.equal((await source.fetchGuide(area))?.area, "Prague");
  assert.equal(urls.length, 2, "English fallback must not repeat the same edition");
  exists = false;
  assert.equal(await source.fetchGuide(area), null);
  assert.equal(urls.length, 3);
});

test("an identified entity with no guide and a disambiguation page are not guides", async () => {
  const source = createWikivoyageSource(
    reader((url) =>
      url.includes("wbgetentities")
        ? { entities: { Q1085: { sitelinks: {} } } }
        : { query: { pages: [{ title: "Springfield", pageprops: { disambiguation: "" } }] } }
    )
  );
  assert.equal(
    await source.fetchGuide({
      name: "Prague",
      wikidataId: "Q1085",
      lang: "en",
      bbox: [14, 49, 15, 51]
    }),
    null
  );
  assert.equal(
    await source.fetchGuide({ name: "Springfield", lang: "en", bbox: [14, 49, 15, 51] }),
    null
  );
});

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

test("selected municipal boundaries reject a namesake article outside their bbox", async () => {
  let parsed = false;
  const source = createWikivoyageSource(
    reader((url) => {
      if (url.includes("action=parse")) {
        parsed = true;
        return { parse: { wikitext: "Prague is a city." } };
      }
      return { query: { pages: [{ title: "Praha", coordinates: [{ lat: 50.08, lon: 14.42 }] }] } };
    })
  );
  assert.equal(
    await source.fetchGuide({
      name: "Praha",
      lang: "cs",
      bbox: [19.47, 48.34, 19.53, 48.4],
      requireCoordinatesInBbox: true
    }),
    null
  );
  assert.equal(parsed, false);
  const guide = await source.fetchGuide({
    name: "Praha",
    lang: "cs",
    bbox: [14.2, 49.9, 14.8, 50.2],
    requireCoordinatesInBbox: true
  });
  assert.equal(guide?.area, "Praha");
});
