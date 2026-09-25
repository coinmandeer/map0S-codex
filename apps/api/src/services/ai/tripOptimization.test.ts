import test from "node:test";
import assert from "node:assert/strict";
import { cheapestInsertion, walkingLoop } from "./tripOptimization.js";
test("insertion chooses the least detour and leaves the fixed order intact", () => {
  const matrix = [
    [0, 10, 20, 2],
    [10, 0, 10, 9],
    [20, 10, 0, 20],
    [2, 9, 20, 0]
  ];
  const order = [0, 1, 2],
    result = cheapestInsertion(matrix, order, 3);
  assert.equal(result?.index, 1);
  assert.deepEqual(order, [0, 1, 2]);
});
test("walking loop closes at the access point and avoids disconnected candidates", () => {
  const m = [
    [0, 2000, 3000, Infinity],
    [2000, 0, 2000, Infinity],
    [3000, 2000, 0, Infinity],
    [Infinity, Infinity, Infinity, 0]
  ];
  const result = walkingLoop(m);
  assert.equal(result[0], 0);
  assert.equal(result.at(-1), 0);
  assert.ok(result.length >= 3);
  assert.ok(!result.includes(3));
});
