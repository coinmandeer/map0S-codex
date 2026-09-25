import assert from "node:assert/strict";
import test from "node:test";
import { maptilerGeocode, maptilerHits } from "./maptilerGeocoding";

test("MapTiler fallback validates coordinates, limits results and retains attribution", () => {
  assert.deepEqual(
    maptilerHits({
      features: [
        { place_name: "Málaga, Andalucía", center: [-4.42, 36.72], place_type: ["municipality"] },
        { place_name: "Invalid", center: [14, 101] },
        { place_name: "No coordinates" }
      ]
    }),
    [
      {
        display_name: "Málaga, Andalucía",
        lon: "-4.42",
        lat: "36.72",
        type: "municipality",
        source: { id: "maptiler", label: "MapTiler / OpenStreetMap" }
      }
    ]
  );
});
test("MapTiler fallback does not make a request without verified free capacity", async () => {
  assert.deepEqual(await maptilerGeocode("Malaga", true, null, new AbortController().signal), []);
});
