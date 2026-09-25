import test from "node:test";
import assert from "node:assert/strict";
import { auroraFeatures, type AuroraGrid } from "./aurora.js";
const now = Date.parse("2026-09-24T00:00:00Z");
const grid: AuroraGrid = {
  "Observation Time": "2026-09-23T23:50:00Z",
  "Forecast Time": "2026-09-24T00:30:00Z",
  coordinates: [
    [350, 65, 0],
    [351, 65, 20],
    [181, -65, 40]
  ]
};
test("aurora preserves zero, UTC forecast and wraparound longitude", () => {
  const result = auroraFeatures(grid, [-12, 64, -8, 66], now);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.properties.probability, 0);
  assert.equal(result[0]!.properties.forecastAt, grid["Forecast Time"]);
  assert.equal(result[0]!.geometry.type, "Point");
  assert.equal(auroraFeatures(grid, [-180, -66, -178, -64], now).length, 1);
});
test("aurora labels aggregate maxima and rejects stale forecasts", () => {
  const result = auroraFeatures(grid, [-180, -90, 180, 90], now);
  assert.equal(result[0]!.properties.aggregation, "maximum");
  assert.equal(result[0]!.properties.probability, 20);
  assert.throws(() => auroraFeatures(grid, [-180, -90, 180, 90], now + 4 * 3600000));
});
