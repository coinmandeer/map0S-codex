import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planV1ToV2,
  type PlanDocumentV2,
  type PlanRoutePreferenceV2,
  type Position
} from "@mapos/layer-sdk";
import { applyPlanCommand } from "./planDocumentService.js";
import {
  SegmentRouteCache,
  routePlanSegments,
  type AdjacentRouteProvider,
  type AdjacentRouteRequest
} from "./segmentRoutingService.js";

function planWithStops(count: number): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: `routing-${count}`,
      name: "Routing test",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: count }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 10 + index / 1_000,
        lat: 45 + index / 1_000,
        dwellMinutes: 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

function provider(options: { failLongitude?: number; delay?: boolean } = {}) {
  const requests: AdjacentRouteRequest[] = [];
  let active = 0;
  let maximumActive = 0;
  const value: AdjacentRouteProvider = {
    id: "fixture-router",
    async route(request) {
      requests.push(request);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (options.delay) await new Promise((resolve) => setTimeout(resolve, 1));
        if (request.endpoints[0][0] === options.failLongitude) throw new Error("fixture failure");
        return {
          alternatives: [
            {
              geometry: {
                type: "LineString",
                coordinates: request.endpoints.map((point) => [...point] as Position)
              },
              distanceM: 1_000,
              durationS: 120,
              warnings: []
            }
          ]
        };
      } finally {
        active -= 1;
      }
    }
  };
  return { value, requests, maximumActive: () => maximumActive };
}

const clock = () => "2026-09-01T09:00:00.000Z";

describe("bounded adjacent-segment routing", () => {
  it("routes 250 stops as 249 two-endpoint calls through a bounded queue", async () => {
    const fixture = provider({ delay: true });
    const result = await routePlanSegments(planWithStops(250), fixture.value, {
      concurrency: 5,
      cache: new SegmentRouteCache(),
      now: clock
    });

    assert.equal(result.plan.stops.length, 250);
    assert.equal(result.plan.segments.length, 249);
    assert.equal(fixture.requests.length, 249);
    assert.ok(fixture.requests.every((request) => request.endpoints.length === 2));
    assert.ok(fixture.maximumActive() <= 5);
    assert.ok(fixture.maximumActive() > 1);
    assert.equal(result.stats.maxConcurrency, 5);
    assert.ok(result.plan.segments.every((segment) => segment.status === "ready"));
  });

  it("forwards every canonical manual profile as an explicit provider request", async () => {
    const preferences: PlanRoutePreferenceV2[] = ["fast", "short", "nohwy", "adventure"];
    for (const preference of preferences) {
      const fixture = provider();
      const document = planWithStops(2);
      document.routePolicy = {
        ...document.routePolicy,
        profile: "camper",
        preference,
        avoid: preference === "nohwy" ? ["motorways"] : []
      };
      document.vehicle = { profile: "camper", heightM: 3.2, weightT: 3.5 };

      await routePlanSegments(document, fixture.value, {
        cache: new SegmentRouteCache(),
        now: clock
      });
      assert.equal(fixture.requests.length, 1);
      assert.deepEqual(fixture.requests[0], {
        endpoints: [
          [10, 45],
          [10.001, 45.001]
        ],
        profile: "camper",
        preference,
        avoid: preference === "nohwy" ? ["motorways"] : [],
        vehicle: { profile: "camper", heightM: 3.2, weightT: 3.5 },
        signal: undefined
      });
    }
  });

  it("reuses a collision-free request cache across documents", async () => {
    const fixture = provider();
    const cache = new SegmentRouteCache();
    const first = await routePlanSegments(planWithStops(3), fixture.value, { cache, now: clock });
    const second = await routePlanSegments(planWithStops(3), fixture.value, { cache, now: clock });
    assert.equal(first.stats.providerCalls, 2);
    assert.equal(second.stats.providerCalls, 0);
    assert.equal(second.stats.cacheHits, 2);
    assert.equal(fixture.requests.length, 2);
  });

  it("reroutes only two neighbours after middle-stop location changes", async () => {
    const fixture = provider();
    const cache = new SegmentRouteCache();
    const routed = await routePlanSegments(planWithStops(6), fixture.value, { cache, now: clock });
    const changed = applyPlanCommand(
      routed.plan,
      {
        id: "change-middle",
        expectedRevision: 1,
        command: {
          type: "update-stop",
          stopId: "stop-3",
          patch: { location: { type: "Point", coordinates: [12, 46] } }
        }
      },
      { now: clock }
    );
    const before = fixture.requests.length;
    const rerouted = await routePlanSegments(changed.plan, fixture.value, { cache, now: clock });

    assert.equal(changed.revision.affectedSegmentIds.length, 2);
    assert.equal(rerouted.stats.eligibleSegments, 2);
    assert.equal(rerouted.stats.providerCalls, 2);
    assert.equal(fixture.requests.length - before, 2);
    assert.ok(rerouted.plan.segments.every((segment) => segment.status === "ready"));
  });

  it("keeps the rest of the plan usable when one segment fails", async () => {
    const fixture = provider({ failLongitude: 10.001 });
    const result = await routePlanSegments(planWithStops(4), fixture.value, {
      cache: new SegmentRouteCache(),
      now: clock
    });
    assert.equal(result.failedSegmentIds.length, 1);
    assert.equal(result.plan.segments.filter((segment) => segment.status === "failed").length, 1);
    assert.equal(result.plan.segments.filter((segment) => segment.status === "ready").length, 2);
  });

  it("coalesces identical in-flight adjacent requests", async () => {
    const plan = planWithStops(4);
    plan.stops[2]!.location = { ...plan.stops[0]!.location };
    plan.stops[3]!.location = { ...plan.stops[1]!.location };
    const fixture = provider({ delay: true });
    const result = await routePlanSegments(plan, fixture.value, {
      concurrency: 3,
      cache: new SegmentRouteCache(),
      now: clock
    });
    assert.equal(result.stats.eligibleSegments, 3);
    assert.equal(result.stats.providerCalls, 2, "A→B and the repeated A→B share one provider call");
    assert.equal(result.stats.cacheHits, 1);
  });
});

describe("saved routing adapter revisions", () => {
  it("reroutes old ready geometry once and reuses current ready geometry", async () => {
    const old = provider();
    const ready = await routePlanSegments(planWithStops(2), old.value, {
      cache: new SegmentRouteCache()
    });
    const current = provider();
    current.value.id = "fixture-router-v2";
    const updated = await routePlanSegments(ready.plan, current.value, {
      cache: new SegmentRouteCache()
    });
    assert.equal(current.requests.length, 1);
    assert.equal(updated.plan.segments[0]!.alternatives[0]!.providerId, "fixture-router-v2");
    await routePlanSegments(updated.plan, current.value, { cache: new SegmentRouteCache() });
    assert.equal(current.requests.length, 1);
  });
});
