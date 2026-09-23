import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMapyRoute } from "./mapyService.js";
import { osrmBase } from "./routingService.js";

test("actual Mapy Feature envelope preserves every road vertex", () => {
  const coordinates = [
    [14.42, 50.08],
    [14.421, 50.085],
    [14.425, 50.084]
  ];
  const result = normalizeMapyRoute({
    length: 800,
    duration: 65,
    geometry: { type: "Feature", geometry: { type: "LineString", coordinates } }
  });
  assert.deepEqual(result.geometry.coordinates, coordinates);
  assert.equal(result.length, 800);
});
test("missing geometry or invalid metrics never produce a successful straight line", () => {
  assert.throws(() => normalizeMapyRoute({ length: 800, duration: 65 }));
  assert.throws(() =>
    normalizeMapyRoute({
      length: -1,
      duration: 65,
      geometry: {
        type: "LineString",
        coordinates: [
          [14, 50],
          [15, 50]
        ]
      }
    })
  );
  assert.doesNotThrow(() =>
    normalizeMapyRoute({
      length: 1,
      duration: 1,
      geometry: {
        type: "LineString",
        coordinates: [
          [14, 50],
          [14.0001, 50]
        ]
      }
    })
  );
});
test("fallback transport graphs differ, not just URL profile names", () => {
  assert.notEqual(osrmBase("foot"), osrmBase("car"));
  assert.notEqual(osrmBase("bike"), osrmBase("car"));
});
