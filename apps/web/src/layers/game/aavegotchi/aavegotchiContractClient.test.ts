import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserProviderBackoff,
  BrowserProviderHealth
} from "../../../tasks/BrowserProviderHealth.js";
import { fetchAavegotchiSvgWithReader } from "./aavegotchiContractClient.js";

test("Base RPC failures open a bounded client circuit", async () => {
  let calls = 0;
  const backoff = new BrowserProviderBackoff({ failureThreshold: 2, openMs: 60_000 });
  const health = new BrowserProviderHealth();
  const reader = async () => {
    calls += 1;
    throw new Error("RPC URL and wallet must never enter telemetry");
  };

  assert.equal(await fetchAavegotchiSvgWithReader("1", reader, backoff, health), null);
  assert.equal(await fetchAavegotchiSvgWithReader("1", reader, backoff, health), null);
  assert.equal(await fetchAavegotchiSvgWithReader("1", reader, backoff, health), null);
  assert.equal(calls, 2);
  assert.deepEqual(
    health.snapshot().map(({ providerId, outcome, count }) => ({ providerId, outcome, count })),
    [
      { providerId: "base-rpc-browser", outcome: "circuit-open", count: 1 },
      { providerId: "base-rpc-browser", outcome: "error", count: 2 }
    ]
  );
  assert.equal(JSON.stringify(health.snapshot()).includes("wallet"), false);
});
