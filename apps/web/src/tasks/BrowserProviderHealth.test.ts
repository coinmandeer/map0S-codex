import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserProviderBackoff, BrowserProviderHealth } from "./BrowserProviderHealth.js";

describe("BrowserProviderHealth", () => {
  it("keeps bounded aggregates without accepting request dimensions", () => {
    let second = 0;
    const health = new BrowserProviderHealth({
      now: () => new Date(Date.UTC(2026, 8, 1, 8, 0, second++)),
      maxProviders: 2
    });
    health.record({ providerId: "rainviewer-browser", outcome: "success", durationMs: 12.4 });
    health.record({ providerId: "rainviewer-browser", outcome: "success", durationMs: 18.8 });
    health.record({ providerId: "base-rpc-browser", outcome: "error", durationMs: 9 });
    health.record({ providerId: "third-provider", outcome: "success", durationMs: 1 });

    assert.deepEqual(health.snapshot(), [
      {
        providerId: "base-rpc-browser",
        outcome: "error",
        count: 1,
        durationMsSum: 9,
        durationMsMax: 9,
        lastAt: "2026-09-01T08:00:02.000Z"
      },
      {
        providerId: "rainviewer-browser",
        outcome: "success",
        count: 2,
        durationMsSum: 31,
        durationMsMax: 19,
        lastAt: "2026-09-01T08:00:01.000Z"
      }
    ]);
    const fields = new Set(health.snapshot().flatMap((bucket) => Object.keys(bucket)));
    for (const privateDimension of ["rawUrl", "bbox", "coordinates", "query", "errorMessage"]) {
      assert.equal(fields.has(privateDimension), false);
    }
  });

  it("rejects dynamic URLs, coordinates and secrets as provider IDs", () => {
    const health = new BrowserProviderHealth();
    for (const providerId of [
      "https://tiles.example.test/1/2/3",
      "provider?bbox=14.4,50.1,14.5,50.2",
      "provider|private-filter",
      "api-key-secret=abc"
    ]) {
      assert.throws(
        () => health.record({ providerId, outcome: "error", durationMs: 1 }),
        /code-owned lowercase slug/
      );
    }
    assert.throws(
      () =>
        health.record({
          providerId: "rainviewer-browser",
          outcome: "https://private.example" as "error",
          durationMs: 1
        }),
      /code-owned value/
    );
  });

  it("records caller cancellation separately from provider errors", () => {
    const health = new BrowserProviderHealth();
    health.record({ providerId: "rainviewer-browser", outcome: "aborted", durationMs: 5 });
    assert.deepEqual(
      health.snapshot().map(({ providerId, outcome, count }) => ({ providerId, outcome, count })),
      [{ providerId: "rainviewer-browser", outcome: "aborted", count: 1 }]
    );
  });
});

describe("BrowserProviderBackoff", () => {
  it("opens after bounded failures and permits one probe after cooldown", () => {
    let now = Date.UTC(2026, 8, 1, 8);
    const backoff = new BrowserProviderBackoff({
      now: () => now,
      failureThreshold: 2,
      openMs: 1_000
    });
    assert.equal(backoff.tryAcquire("base-rpc-browser"), true);
    backoff.failure("base-rpc-browser");
    assert.equal(backoff.tryAcquire("base-rpc-browser"), true);
    backoff.failure("base-rpc-browser");
    assert.equal(backoff.tryAcquire("base-rpc-browser"), false);
    assert.equal(backoff.snapshot()[0]?.state, "open");

    now += 1_000;
    assert.equal(backoff.tryAcquire("base-rpc-browser"), true);
    assert.equal(backoff.tryAcquire("base-rpc-browser"), false);
    assert.equal(backoff.snapshot()[0]?.state, "half-open");
    backoff.success("base-rpc-browser");
    assert.equal(backoff.tryAcquire("base-rpc-browser"), true);
    assert.equal(backoff.snapshot()[0]?.consecutiveFailures, 0);
  });

  it("releases an aborted half-open probe without adding a provider failure", () => {
    let now = Date.UTC(2026, 8, 1, 8);
    const backoff = new BrowserProviderBackoff({
      now: () => now,
      failureThreshold: 1,
      openMs: 1_000
    });
    assert.equal(backoff.tryAcquire("rainviewer-browser"), true);
    backoff.failure("rainviewer-browser");
    now += 1_000;
    assert.equal(backoff.tryAcquire("rainviewer-browser"), true);
    backoff.aborted("rainviewer-browser");
    assert.equal(backoff.tryAcquire("rainviewer-browser"), true);
    assert.equal(backoff.snapshot()[0]?.consecutiveFailures, 1);
  });
});
