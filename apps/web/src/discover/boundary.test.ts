import assert from "node:assert/strict";
import test from "node:test";
import { discoverBoundaryBbox } from "./boundary";

test("real polygon coordinates produce a fit extent without accepting an invalid point", () => {
  assert.deepEqual(
    discoverBoundaryBbox({
      type: "Polygon",
      coordinates: [
        [
          [13.2, 49.6],
          [13.7, 49.6],
          [13.7, 49.9],
          [13.2, 49.6]
        ]
      ]
    }),
    [13.2, 49.6, 13.7, 49.9]
  );
  assert.equal(
    discoverBoundaryBbox({
      type: "Polygon",
      coordinates: [
        [
          [Number.NaN, 49],
          [13, 49],
          [13, 49],
          [Number.NaN, 49]
        ]
      ]
    }),
    null
  );
});
