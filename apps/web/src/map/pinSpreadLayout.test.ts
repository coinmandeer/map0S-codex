import assert from "node:assert/strict";
import test from "node:test";
import { pinSpreadOffsets } from "./pinSpreadLayout";
test("coincident pin buttons remain separated within a bounded twelve-pin spread", () => {
  for (let n = 2; n <= 12; n++) {
    const offsets = pinSpreadOffsets(n);
    assert.equal(offsets.length, n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        assert.ok(
          Math.hypot(offsets[i]![0] - offsets[j]![0], offsets[i]![1] - offsets[j]![1]) >= 34
        );
    assert.ok(offsets.every(([x, y]) => Math.hypot(x, y) < 74));
  }
  for (const n of [0, 1, 13, Infinity, 2.5]) assert.deepEqual(pinSpreadOffsets(n), []);
});
