import assert from "node:assert/strict";
import test from "node:test";
import { GAME_ROAD_SOURCE } from "./roadSource";

test("fallback road geometry keeps its remote URL and complete rights in one inventory record", () => {
  assert.match(GAME_ROAD_SOURCE.tileJsonUrl, /^https:\/\/tiles\.basemaps\.cartocdn\.com\//);
  assert.deepEqual(
    GAME_ROAD_SOURCE.attribution.map(({ label, license }) => [label, license]),
    [
      ["© OpenStreetMap přispěvatelé", "ODbL-1.0"],
      ["© CARTO", "CARTO Maps API Terms"]
    ]
  );
  assert.ok(GAME_ROAD_SOURCE.attribution.every(({ url }) => url?.startsWith("https://")));
});
