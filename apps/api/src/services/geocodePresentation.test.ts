import assert from "node:assert/strict";
import test from "node:test";
import {
  geocodeConfidence,
  nearViewbox,
  parseNearPoint,
  presentMapyGeocodeResult,
  presentNominatimGeocodeResult
} from "./geocodePresentation.js";

test("geocoder presentation preserves type, hierarchy, source and transparent ranked confidence", () => {
  const mapy = presentMapyGeocodeResult(
    {
      name: "Plzeň",
      label: "Město",
      location: "Česko",
      position: { lon: 13.3775, lat: 49.7475 },
      type: "regional",
      regionalStructure: [
        { name: "Plzeň-město", type: "regional" },
        { name: "Plzeňský kraj", type: "regional" }
      ]
    },
    0
  );
  assert.equal(mapy.type, "regional");
  assert.equal(mapy.display_name, "Plzeň");
  assert.deepEqual(mapy.hierarchy, ["Česko"]);
  assert.deepEqual(mapy.source, { id: "mapy", label: "Mapy.com" });
  assert.deepEqual(mapy.confidence, {
    level: "high",
    label: "vysoká",
    basis: "provider-order"
  });

  const osm = presentNominatimGeocodeResult(
    {
      display_name: "Karlín, Praha, Česko",
      lat: "50.09",
      lon: "14.45",
      addresstype: "suburb",
      address: { suburb: "Karlín", city: "Praha", country: "Česko" }
    },
    3
  );
  assert.equal(osm.type, "suburb");
  assert.deepEqual(osm.hierarchy, ["Karlín", "Praha", "Česko"]);
  assert.equal(osm.source.label, "OpenStreetMap / Nominatim");
  assert.equal(osm.confidence.level, "low");
});

test("confidence is explicitly ordinal instead of pretending to be a provider probability", () => {
  assert.equal(geocodeConfidence(0).basis, "provider-order");
  assert.equal(geocodeConfidence(2).level, "medium");
  assert.equal(geocodeConfidence(20).level, "low");
});

test("the near-point search bias is coarse and ignores malformed input", () => {
  assert.deepEqual(parseNearPoint("14.42076,50.08804"), [14.42, 50.09]);
  assert.deepEqual(parseNearPoint(" -0.1276 , 51.5072 "), [-0.13, 51.51]);
  for (const value of [undefined, "", "14.4", "a,b", "14,50,1", "200,50", "14,95", "1".repeat(80)])
    assert.equal(parseNearPoint(value), null, String(value));
  assert.equal(nearViewbox([14.42, 50.09]), "14.12,50.39,14.72,49.79");
  assert.equal(nearViewbox([179.9, 89.9]), "179.6,90,180,89.6");
});
