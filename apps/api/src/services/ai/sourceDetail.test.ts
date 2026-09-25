import test from "node:test";
import assert from "node:assert/strict";
import { sourceIdForTarget } from "./sourceDetail.js";

test("weed details resolve only canonical OpenStreetMap source ids", () => {
  assert.equal(sourceIdForTarget("weed", "osm:node:123"), "osm:node:123");
  assert.equal(sourceIdForTarget("weed", "osm:way:456"), "osm:way:456");
  assert.equal(sourceIdForTarget("weed", "park4night:123"), null);
  assert.equal(sourceIdForTarget("weed", "osm:node:123/../456"), null);
});
