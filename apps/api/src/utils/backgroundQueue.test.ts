import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundQueue } from "./backgroundQueue.js";

test("background work is deduplicated, globally bounded and drains after failures", async () => {
  const queue = new BackgroundQueue(2, 3);
  const releases: Array<() => void> = [];
  let calls = 0;
  const work = () => {
    calls++;
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  assert.equal(queue.enqueue("a", work), true);
  assert.equal(queue.enqueue("a", work), true);
  assert.equal(queue.enqueue("b", work), true);
  assert.equal(
    queue.enqueue("c", async () => {
      calls++;
      throw new Error("provider offline");
    }),
    true
  );
  assert.equal(queue.enqueue("overflow", work), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(queue.stats(), { active: 2, queued: 1, cooling: 0 });
  releases[0]!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(queue.enqueue("c", work), false, "failure backoff prevents retry storms");
  releases[1]!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.stats(), { active: 0, queued: 0, cooling: 1 });
});
