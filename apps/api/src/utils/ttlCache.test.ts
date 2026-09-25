import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "./ttlCache.js";

test("concurrent reads of one key share a single load and later reads hit the cache", async () => {
  let loads = 0;
  let release!: (value: string) => void;
  const cache = new TtlCache<string>({ ttlMs: 1_000, maxEntries: 4 });
  const load = () => {
    loads++;
    return new Promise<string>((resolve) => (release = resolve));
  };
  const first = cache.getOrLoad("a", load);
  const second = cache.getOrLoad("a", load);
  release("value");
  assert.deepEqual(await Promise.all([first, second]), ["value", "value"]);
  assert.equal(await cache.getOrLoad("a", load), "value");
  assert.equal(loads, 1);
});

test("entries expire, failures are not cached and the bound drops the least recent key", async () => {
  let now = 0;
  const cache = new TtlCache<number>({ ttlMs: 100, maxEntries: 2, now: () => now });
  await assert.rejects(cache.getOrLoad("x", () => Promise.reject(new Error("db down"))));
  assert.equal(await cache.getOrLoad("x", async () => 1), 1, "a failure is retried");

  cache.set("y", 2);
  assert.equal(cache.get("x"), 1, "a hit refreshes recency");
  cache.set("z", 3);
  assert.equal(cache.get("y"), undefined, "the least recently used key made room");
  assert.equal(cache.get("x"), 1);

  now = 150;
  assert.equal(cache.get("x"), undefined, "expired");
  assert.equal(cache.size, 1);
});
