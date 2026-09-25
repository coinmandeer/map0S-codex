import test from "node:test";
import assert from "node:assert/strict";
import { googleMaximumZoom } from "./googleZoom";
test("Google zoom follows centre coverage including the date line, not unrelated rectangles", () => {
  const rectangles = [
    { west: 170, east: -170, south: -20, north: 20, maxZoom: 17 },
    { west: 10, east: 20, south: 45, north: 55, maxZoom: 12 }
  ];
  assert.equal(googleMaximumZoom(rectangles, 179, 0, 22), 17);
  assert.equal(googleMaximumZoom(rectangles, -179, 0, 22), 17);
  assert.equal(googleMaximumZoom(rectangles, 14, 50, 22), 12);
  assert.equal(googleMaximumZoom(rectangles, -4, 36, 22), 22);
  assert.equal(googleMaximumZoom([{ maxZoom: 99 }], 0, 0, 18), 18);
});
