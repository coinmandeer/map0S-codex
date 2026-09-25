import assert from "node:assert/strict";
import test from "node:test";
import { verifyGotchiOwner, LiveGotchiInventory } from "./gotchi.js";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";

test("gotchi ownership uses guarded RPC without retaining stale ownership", async () => {
  const owner = "0x1111111111111111111111111111111111111111";
  let calls = 0;
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body!);
      assert.equal(body.method, "eth_call");
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(24) + owner.slice(2) }),
        { headers: { "content-type": "application/json" } }
      );
    }
  });
  try {
    await verifyGotchiOwner([owner], "1");
    await verifyGotchiOwner([owner], "1");
    assert.equal(calls, 2);
    await assert.rejects(
      verifyGotchiOwner(["0x2222222222222222222222222222222222222222"], "1"),
      /nepatří/
    );
  } finally {
    __resetUpstreamCache();
  }
});

test("private DNS cannot be reached by the gotchi inventory", async () => {
  let calls = 0;
  __setUpstreamTestDependencies({
    resolveHost: async () => ["127.0.0.1"],
    request: async () => {
      calls++;
      throw new Error("Must not reach transport");
    }
  });
  try {
    const result = await new LiveGotchiInventory().load(
      "0x1111111111111111111111111111111111111111"
    );
    assert.equal(result.status, "unavailable");
    assert.equal(calls, 0);
  } finally {
    __resetUpstreamCache();
  }
});

test("the warmed default appearance survives an unavailable upstream", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { GotchiAssets } = await import("./gotchi.js");
  const directory = await mkdtemp(join(tmpdir(), "mapos-gotchi-cache-test-"));
  const old = process.env.MAPOS_GOTCHI_CACHE_DIR;
  process.env.MAPOS_GOTCHI_CACHE_DIR = directory;
  let requests = 0;
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async () => {
      requests++;
      throw new Error("offline");
    }
  });
  const hash = "a".repeat(64),
    url = `/api/v2/world/models/${hash}.glb`;
  try {
    await writeFile(join(directory, `${hash}.glb`), Buffer.from("glTFcache-fixture"));
    await writeFile(
      join(directory, "default-100.json"),
      JSON.stringify({
        tokenId: "100",
        status: "ready",
        url,
        lods: [{ level: "low", url, bytes: 17, triangles: 0, drawCalls: 0, textureBytes: 0 }]
      })
    );
    const assets = new GotchiAssets();
    assets.request("100");
    for (let n = 0; n < 100 && assets.request("100").status === "pending"; n++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(assets.request("100").status, "ready");
    assert.equal(requests, 0);
  } finally {
    if (old === undefined) delete process.env.MAPOS_GOTCHI_CACHE_DIR;
    else process.env.MAPOS_GOTCHI_CACHE_DIR = old;
    __resetUpstreamCache();
    await rm(directory, { recursive: true, force: true });
  }
});
