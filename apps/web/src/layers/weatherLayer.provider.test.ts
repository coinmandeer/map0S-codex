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
