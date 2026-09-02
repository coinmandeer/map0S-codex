import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { ApiError } from "../lib/api.js";
import { TaskRegistry } from "../tasks/TaskRegistry.js";
import { startRoutingPlanTask, type RoutedPlanResponse } from "./routingTask.js";

const plan = planV1ToV2(
  {
    id: "routing-task-fixture",
    name: "Fixture",
    departureAt: "2026-09-01T08:00:00.000Z",
    variant: "fast",
    stops: [
      { id: "a", name: "A", lng: 14.4, lat: 50.1, dwellMinutes: 0 },
      { id: "b", name: "B", lng: 14.5, lat: 50.2, dwellMinutes: 0 }
    ],
    vehicle: { profile: "car" },
    visibility: "private"
  },
  { now: "2026-09-01T08:00:00.000Z" }
);

function registry() {
  let tick = 0;
  return new TaskRegistry({
    now: () => new Date(Date.UTC(2026, 8, 1, 9, 0, tick++)),
    id: () => "task:routing:fixture"
  });
}

function response(stats: RoutedPlanResponse["stats"]): RoutedPlanResponse {
  return { plan, failedSegmentIds: ["segment-failed"], stats };
}

describe("routing task diagnostics", () => {
  it("routes an uncapped product plan through overlapping bounded transport batches", async () => {
    const largePlan = planV1ToV2(
      {
        id: "routing-task-large",
        name: "Large fixture",
        departureAt: "2026-09-01T08:00:00.000Z",
        variant: "fast",
        stops: Array.from({ length: 205 }, (_, index) => ({
          id: `stop-${index}`,
          name: `Stop ${index}`,
          lng: 14.4 + index / 100_000,
          lat: 50.1 + index / 100_000,
          dwellMinutes: 0
        })),
        vehicle: { profile: "car" },
        visibility: "private"
      },
      { now: "2026-09-01T08:00:00.000Z" }
    );
    const batchSizes: number[] = [];
    const run = startRoutingPlanTask(largePlan, "osm", {
      registry: registry(),
      request: async (batch) => {
        batchSizes.push(batch.stops.length);
        return {
          data: {
            plan: batch,
            failedSegmentIds: [],
            stats: {
              eligibleSegments: batch.segments.length,
              providerCalls: batch.segments.length,
              cacheHits: 0,
              maxConcurrency: Math.min(4, batch.segments.length)
            }
          },
          requestId: null
        };
      }
    });

    const result = await run.result;
    assert.deepEqual(batchSizes, [100, 100, 7]);
    assert.equal(result.plan.stops.length, 205);
    assert.equal(result.plan.segments.length, 204);
    assert.deepEqual(
      result.plan.segments.map((segment) => segment.order),
      Array.from({ length: 204 }, (_, index) => index)
    );
    assert.equal(result.stats.eligibleSegments, 204);
    assert.equal(result.stats.providerCalls, 204);
    assert.equal(result.stats.maxConcurrency, 4);
  });

  it("retains segment stats, duration and safe request/provider correlation", async () => {
    const tasks = registry();
    const run = startRoutingPlanTask(plan, "osm", {
      registry: tasks,
      request: async (_plan, _provider, signal) => {
        assert.equal(signal.aborted, false);
        return {
          data: response({
            eligibleSegments: 3,
            providerCalls: 2,
            cacheHits: 1,
            maxConcurrency: 2
          }),
          requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
        };
      }
    });

    assert.equal((await run.result).plan.id, plan.id);
    const task = tasks.get(run.taskId)!;
    assert.equal(task.status, "succeeded");
    assert.equal(task.telemetry?.durationMs, 1_000);
    assert.equal(task.telemetry?.cache, "mixed");
    assert.equal(task.telemetry?.eligibleSegments, 3);
    assert.equal(task.telemetry?.providerCalls, 2);
    assert.equal(task.telemetry?.cacheHits, 1);
    assert.equal(task.telemetry?.maxConcurrency, 2);
    assert.equal(task.telemetry?.failedSegments, 1);
    assert.deepEqual(task.correlation, {
      requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285",
      providerId: "osm"
    });
    const serialized = JSON.stringify(task);
    assert.equal(serialized.includes("14.4"), false);
    assert.equal(serialized.includes("50.1"), false);
    assert.equal(serialized.includes("routing-task-fixture"), false);
  });

  it("records a correlated HTTP failure without request inputs", async () => {
    const tasks = registry();
    const run = startRoutingPlanTask(plan, "mapy", {
      registry: tasks,
      request: async () => {
        throw new ApiError(503, "unavailable", "3db0c9d7-4d8d-4d49-999b-ae47bf332285");
      }
    });
    await assert.rejects(run.result, /unavailable/);
    const task = tasks.get(run.taskId)!;
    assert.equal(task.status, "failed");
    assert.equal(task.error?.code, "ROUTING_HTTP_503");
    assert.equal(task.error?.retryable, true);
    assert.equal(task.telemetry?.durationMs, 1_000);
    assert.equal(task.correlation?.providerId, "mapy");
  });

  it("aborts the request through TaskRegistry and never applies a late result", async () => {
    const tasks = registry();
    const run = startRoutingPlanTask(plan, "osm", {
      registry: tasks,
      request: (_plan, _provider, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        })
    });
    assert.equal(run.cancel(), true);
    await assert.rejects(
      run.result,
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
    const task = tasks.get(run.taskId)!;
    assert.equal(task.status, "cancelled");
    assert.equal(task.telemetry?.aborted, true);
    assert.equal(task.telemetry?.durationMs, 1_000);
  });
});
