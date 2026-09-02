import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TaskRegistry } from "./TaskRegistry.js";

function fixtureRegistry(maxRecords = 100) {
  let tick = 0;
  return new TaskRegistry({
    now: () => new Date(Date.UTC(2026, 8, 1, 8, 0, tick++)),
    id: (type) => `task:${type}:${tick}`,
    maxRecords
  });
}

describe("TaskRegistry", () => {
  it("publishes schema-valid serialisable snapshots and terminal progress", () => {
    const registry = fixtureRegistry();
    let notifications = 0;
    registry.subscribe(() => notifications++);
    const task = registry.start({
      type: "layer-query",
      label: "Načítám OSM",
      layerId: "osm-poi",
      requestKey: "rk_0123456789abcdef",
      telemetry: { budget: 100 }
    });
    assert.equal(task.status, "running");
    assert.equal(registry.progress(task.id, 0.5, "50 výsledků"), true);
    assert.equal(registry.succeed(task.id, { received: 50 }), true);

    const finished = registry.get(task.id)!;
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.progress, 1);
    assert.equal(finished.telemetry?.received, 50);
    assert.equal(finished.telemetry?.durationMs, 1_000);
    assert.equal(finished.requestKey, "rk_0123456789abcdef");
    assert.ok(finished.finishedAt);
    assert.equal(notifications, 3);
    assert.doesNotThrow(() => JSON.stringify(registry.snapshot()));
  });

  it("cancels a running task once and keeps callbacks outside snapshots", () => {
    const registry = fixtureRegistry();
    let cancels = 0;
    const task = registry.start({
      type: "layer-query",
      label: "Načítám vrstvu",
      cancellable: true,
      cancel: () => cancels++
    });
    assert.equal(registry.cancel(task.id), true);
    assert.equal(registry.cancel(task.id), false);
    assert.equal(cancels, 1);
    assert.equal(registry.get(task.id)?.status, "cancelled");
    assert.equal(registry.get(task.id)?.telemetry?.aborted, true);
    assert.equal(registry.get(task.id)?.telemetry?.durationMs, 1_000);
    const snapshot = registry.snapshot()[0] as unknown as Record<string, unknown>;
    assert.equal("cancel" in snapshot, false);
    assert.equal("retry" in snapshot, false);
  });

  it("marks superseded work stale and exposes retry only for retryable failures", async () => {
    const registry = fixtureRegistry();
    let retries = 0;
    const stale = registry.start({ type: "layer-query", label: "Old request" });
    assert.equal(registry.markStale(stale.id), true);
    assert.equal(registry.get(stale.id)?.status, "stale");

    const failed = registry.start({
      type: "routing",
      label: "Route",
      retry: () => {
        retries++;
      }
    });
    registry.fail(failed.id, { code: "UPSTREAM", message: "Provider down", retryable: true });
    assert.equal(registry.retry(failed.id), true);
    await Promise.resolve();
    assert.equal(retries, 1);
  });

  it("retains active work while pruning the oldest terminal history", () => {
    const registry = fixtureRegistry(2);
    const active = registry.start({ type: "sync", label: "Active" });
    const old = registry.start({ type: "export", label: "Old" });
    registry.succeed(old.id);
    const recent = registry.start({ type: "import", label: "Recent" });
    registry.succeed(recent.id);
    assert.equal(registry.get(active.id)?.status, "running");
    assert.equal(registry.get(old.id), undefined);
    assert.equal(registry.get(recent.id)?.status, "succeeded");
  });

  it("rejects invalid progress instead of publishing malformed task state", () => {
    const registry = fixtureRegistry();
    const task = registry.start({ type: "ai", label: "AI" });
    assert.throws(() => registry.progress(task.id, 1.1), /between 0 and 1/);
    assert.equal(registry.get(task.id)?.progress, null);
  });

  it("stores only schema-valid request/provider correlation on a terminal task", () => {
    const registry = fixtureRegistry();
    const task = registry.start({ type: "routing", label: "Route" });
    assert.equal(
      registry.succeed(
        task.id,
        { cache: "hit", providerId: "osm" },
        {
          requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285",
          providerId: "osm"
        }
      ),
      true
    );
    assert.deepEqual(registry.get(task.id)?.correlation, {
      requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285",
      providerId: "osm"
    });

    const invalid = registry.start({ type: "routing", label: "Unsafe" });
    assert.throws(
      () => registry.succeed(invalid.id, {}, { requestId: "url?lat=50", providerId: "osm" }),
      /correlation.requestId/
    );
    assert.equal(registry.get(invalid.id)?.status, "running");
  });

  it("exposes retry capability and only dismisses terminal records", async () => {
    const registry = fixtureRegistry();
    let retries = 0;
    const active = registry.start({ type: "sync", label: "Active" });
    const failed = registry.start({
      type: "weather",
      label: "Weather",
      retry: () => {
        retries += 1;
      }
    });
    registry.fail(failed.id, { code: "UPSTREAM", message: "Down", retryable: true });

    assert.equal(registry.canRetry(failed.id), true);
    assert.equal(registry.retry(failed.id), true);
    await Promise.resolve();
    assert.equal(retries, 1);
    assert.equal(registry.dismiss(active.id), false);
    assert.equal(registry.dismiss(failed.id), true);
    assert.equal(registry.get(failed.id), undefined);
  });
});
