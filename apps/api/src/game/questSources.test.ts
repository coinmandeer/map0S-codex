import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveQuest } from "./anchors.js";
import { __testing, monumentsWithoutPhoto, opencaching, osmNotes } from "./questSources.js";

const { okapiAnchor, wlmAnchor, osmNoteAnchor, turfAnchor } = __testing;

test("an Opencaching cache carries the link its licence requires", () => {
  const anchor = okapiAnchor("pl", {
    code: "OP9CV1",
    name: "Stará vodárna",
    location: "50.0755|14.4378",
    difficulty: 3,
    terrain: 2,
    url: "https://opencaching.pl/viewcache.php?wp=OP9CV1"
  });

  assert.ok(anchor);
  assert.equal(anchor.ref, "oc:pl:OP9CV1");
  assert.deepEqual([anchor.lng, anchor.lat], [14.4378, 50.0755]);
  assert.equal(anchor.externalUrl, "https://opencaching.pl/viewcache.php?wp=OP9CV1");
  // Hidden containers need a tighter radius than a castle you can see from the road.
  assert.ok(anchor.radiusM! < 100);

  const quest = deriveQuest(opencaching, anchor);
  assert.match(quest.title, /Najdi keš/);
  assert.equal(quest.externalUrl, anchor.externalUrl);
});

test("a cache without coordinates is not an anchor", () => {
  assert.equal(okapiAnchor("pl", { code: "OP1", name: "Bez pozice" }), null);
  assert.equal(okapiAnchor("pl", { code: "OP1", location: "50|14" }), null);
});

test("a monument quest asks for the photograph that is missing", () => {
  const anchor = wlmAnchor({
    id: "12345",
    country: "cz",
    name: "Kaple sv. Anny",
    lat: 49.8,
    lon: 14.2
  });

  assert.ok(anchor);
  assert.equal(anchor.ref, "wlm:cz:12345");
  const quest = deriveQuest(monumentsWithoutPhoto, anchor);
  assert.match(quest.title, /Vyfoť/);
  assert.match(quest.description, /Commons/);
});

test("an OSM note becomes the question somebody left on the map", () => {
  const anchor = osmNoteAnchor({
    geometry: { coordinates: [14.42, 50.08] },
    properties: {
      id: 4242,
      status: "open",
      comments: [{ text: "Je tahle cesta ještě průchozí?", action: "opened" }]
    }
  });

  assert.ok(anchor);
  assert.equal(anchor.ref, "osmnote:4242");
  assert.equal(anchor.name, "Je tahle cesta ještě průchozí?");
  assert.equal(anchor.externalUrl, "https://www.openstreetmap.org/note/4242");
  assert.match(deriveQuest(osmNotes, anchor).title, /Zmapuj/);
});

test("a Turf zone is worth more when it earns more per hour", () => {
  const quiet = turfAnchor({ name: "Sleepy", latitude: 50, longitude: 14, pointsPerHour: 1 });
  const busy = turfAnchor({ name: "Busy", latitude: 50, longitude: 14, pointsPerHour: 25 });
  assert.ok(quiet && busy);
  assert.ok(busy.weight! > quiet.weight!);
});

test("without an OKAPI key the source says so instead of returning nothing", () => {
  // No key is configured in tests, so this is the state a fresh clone starts in.
  assert.match(opencaching.unavailableReason?.() ?? "", /OKAPI/);
});

test("OKAPI encodes bbox and cache-code separators accepted by all four national instances", () => {
  const url = __testing.okapiUrl("opencache.uk", "caches/search/bbox", "test-key", {
    bbox: "51|-1|52|0",
    limit: "1"
  });
  assert.ok(!url.includes("|"));
  assert.equal(new URL(url).searchParams.get("bbox"), "51|-1|52|0");
});
