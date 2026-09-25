import assert from "node:assert/strict";
import { test } from "node:test";
import { createDataSourceProvider } from "./index.js";
const bbox: [number, number, number, number] = [14, 50, 15, 51];
test("oversized source query is not successful zero results and does not call upstream", async () => {
  let calls = 0;
  const provider = createDataSourceProvider({
    id: "test",
    tooLarge: () => "Přibližte",
    load: async () => {
      calls++;
      return [];
    }
  });
  const result = await provider.features!({ bbox, query: {} });
  assert.equal(calls, 0);
  assert.equal(result.query?.status, "unavailable");
  assert.equal(result.query?.reason, "zoom-required");
});
test("failed upstream differs from a genuinely empty result", async () => {
  const failed = createDataSourceProvider({
    id: "test",
    load: async () => {
      throw new Error("failure");
    }
  });
  const empty = createDataSourceProvider({ id: "test", load: async () => [] });
  assert.equal((await failed.features!({ bbox, query: {} })).query?.status, "unavailable");
  assert.notEqual((await empty.features!({ bbox, query: {} })).query?.status, "unavailable");
});
test("consumer cancellation reaches source and is never converted into empty success", async () => {
  const controller = new AbortController();
  const provider = createDataSourceProvider({
    id: "test",
    load: async (_bbox, _query, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      signal!.throwIfAborted();
      return [];
    }
  });
  await assert.rejects(provider.features!({ bbox, query: {}, signal: controller.signal }), {
    name: "AbortError"
  });
});

test("partial source results retain successful features and an explicit notice", async () => {
  const provider = createDataSourceProvider({
    id: "partial",
    async load() {
      return { features: [], status: "partial", notice: "2 providers unavailable" };
    }
  });
  const result = await provider.features!({ bbox: [0, 0, 1, 1], query: {} });
  assert.equal(result.query?.status, "partial");
  assert.equal(result.notice, "2 providers unavailable");
  assert.equal(result.query?.cacheTtlMs, 0);
});
