import assert from "node:assert/strict";
import test from "node:test";
import {
  geocodeConfidence,
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
