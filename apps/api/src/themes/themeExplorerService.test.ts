import assert from "node:assert/strict";
import test from "node:test";
import { coverageRequest } from "./themeExplorerService.js";

test("catalogue coverage is shared by neighbouring views in one zoom band", () => {
  const prague = coverageRequest([14.31, 50.02, 14.55, 50.13], 11.4);
  const pannedPrague = coverageRequest([14.36, 50.04, 14.6, 50.15], 10.2);
  assert.deepEqual(prague, { bbox: [14.25, 50, 14.75, 50.25], zoom: 8 });
  assert.deepEqual(pannedPrague, prague, "a short pan reuses the computation");

  // The band edges are the zooms at which the dataset choice changes.
  assert.equal(coverageRequest(null, 7.99).zoom, 6);
  assert.equal(coverageRequest(null, 4).zoom, 4);
  assert.equal(coverageRequest(null, 2).zoom, 0);
  assert.deepEqual(coverageRequest([-179.5, -89, 179.5, 89], 1).bbox, [-180, -90, 180, 90]);
  assert.deepEqual(coverageRequest([12.1, 48.6, 18.9, 51.1], 6.5).bbox, [12, 48, 19, 52]);
});
