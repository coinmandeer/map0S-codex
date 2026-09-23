import assert from "node:assert/strict";
import test from "node:test";
import { browserProviderBackoff, browserProviderHealth } from "../tasks/BrowserProviderHealth.js";
import { __resetLiveRadarPathCacheForTests, loadLiveRadarPath } from "./weatherLayer.js";

test("RainViewer metadata failure is negative-cached instead of retried on every refresh", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  };
  __resetLiveRadarPathCacheForTests();
  browserProviderBackoff.clear();
  browserProviderHealth.reset();

  try {
    assert.equal(await loadLiveRadarPath(), null);
    assert.equal(await loadLiveRadarPath(), null);
    assert.equal(await loadLiveRadarPath(), null);
    assert.equal(calls, 1);
    assert.equal(
      browserProviderHealth
        .snapshot()
        .find((item) => item.providerId === "rainviewer-browser" && item.outcome === "error")
        ?.count,
      1
    );
  } finally {
    globalThis.fetch = originalFetch;
    __resetLiveRadarPathCacheForTests();
    browserProviderBackoff.clear();
    browserProviderHealth.reset();
  }
});

test("weather grid failures remain failures and cancellation reaches the transport", async (t) => {
  const { loadGrid } = await import("./weatherLayer.js");
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await assert.rejects(loadGrid([0, 0, 1, 1], "temperature", null, 2, 2, "best_match"), /503/);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ cols: 2, rows: 2, values: [], sampleCount: 0 })
  );
  await assert.rejects(
    loadGrid([0, 0, 1, 1], "temperature", null, 2, 2, "best_match"),
    /nejsou dostupné/
  );
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    assert.equal(options?.signal, controller.signal);
    throw new DOMException("Cancelled", "AbortError");
  });
  controller.abort();
  await assert.rejects(
    loadGrid([0, 0, 1, 1], "temperature", null, 2, 2, "best_match", controller.signal),
    { name: "AbortError" }
  );
});
