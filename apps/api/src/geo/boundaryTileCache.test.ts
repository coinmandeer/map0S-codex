import assert from "node:assert/strict";
import test from "node:test";
import { cachedBoundaryTile } from "./boundaryTileCache.js";
test("boundary cache coalesces visitors but isolates area scopes and revisions", async () => {
  let calls = 0;
  const generate = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return new Uint8Array([calls]);
  };
  const key = ["cache-test", 1, 2, 3, "parent-a"];
  const [a, b] = await Promise.all([
    cachedBoundaryTile(key, generate),
    cachedBoundaryTile(key, generate)
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await cachedBoundaryTile(key, generate);
  assert.equal(calls, 1);
  await cachedBoundaryTile(["cache-test", 1, 2, 3, "parent-b"], generate);
  assert.equal(calls, 2);
  await cachedBoundaryTile(["cache-test-v2", 1, 2, 3, "parent-a"], generate);
  assert.equal(calls, 3);
});

test("disk cache survives a new cache instance and isolates immutable revisions", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createBoundaryTileCache } = await import("./boundaryTileCache.js");
  const dir = await mkdtemp(join(tmpdir(), "mapos-boundary-test-"));
  try {
    const key = ["revision-1", "country", 3, 4, 2, null];
    await createBoundaryTileCache(dir)(key, async () => new Uint8Array([3, 4, 5]));
    const restored = await createBoundaryTileCache(dir)(key, async () => {
      throw Error("must not regenerate");
    });
    assert.deepEqual([...restored], [3, 4, 5]);
    const different = await createBoundaryTileCache(dir)(
      ["revision-2", ...key.slice(1)],
      async () => new Uint8Array([6])
    );
    assert.deepEqual([...different], [6]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
