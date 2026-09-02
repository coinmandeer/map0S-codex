import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import {
  buildPlanTemporalContext,
  PLAN_WEATHER_STOP_BUDGET
} from "./planTemporalContextService.js";

function routedPlan(stopCount = 3): PlanDocumentV2 {
  const plan = planV1ToV2(
    {
      id: `temporal-${stopCount}`,
      name: "Dated context",
      departureAt: "2026-09-02T10:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: stopCount }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 13 + index / 100,
        lat: 49,
        dwellMinutes: index === 1 ? 30 : 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-02T09:00:00.000Z" }
  );
  plan.segments = plan.segments.map((segment) => {
    const alternativeId = `route-${segment.id}`;
    return {
      ...segment,
      status: "ready",
      provider: "mapos-routing:osm",
      alternatives: [
        {
          id: alternativeId,
          providerId: "mapos-routing:osm",
          profile: "car",
          preference: "fast",
          geometry: {
            type: "LineString",
            coordinates: [
              plan.stops[segment.order]!.location.coordinates,
              plan.stops[segment.order + 1]!.location.coordinates
            ]
          },
          distanceM: 10_000,
          durationS: 3_600,
          warnings: []
        }
      ],
      selectedAlternativeId: alternativeId
    };
  });
  return plan;
}

describe("dated plan temporal context", () => {
  it("uses one bounded real-weather sample set and publishes honest segment timing/warnings", async () => {
    const plan = routedPlan(25);
    let calls = 0;
    const context = await buildPlanTemporalContext(
      plan,
      "osm",
      async (stops, arrivalTimes) => {
        calls += 1;
        assert.equal(stops.length, PLAN_WEATHER_STOP_BUDGET);
        assert.equal(arrivalTimes.length, PLAN_WEATHER_STOP_BUDGET);
        return stops.map((stop, index) => ({
          stopId: stop.id,
          at: arrivalTimes[index]!,
          temperature: index === 1 ? 35 : 18,
          precipitation: index === 1 ? 1.2 : 0,
          weatherCode: index === 1 ? 61 : 0
        }));
      },
      new Date("2026-09-02T09:00:00.000Z")
    );

    assert.equal(calls, 1);
    assert.equal(context.status, "active");
    assert.equal(context.weather.status, "ready");
    assert.equal(context.weather.sampledStops, PLAN_WEATHER_STOP_BUDGET);
    assert.equal(context.dataBudget.upstreamWeatherRequests, 1);
    assert.equal(context.traffic.status, "unavailable");
    assert.match(context.traffic.reason ?? "", /nic se nesimuluje/i);
    assert.equal(context.segments[0]!.departureAt, "2026-09-02T10:00:00.000Z");
    assert.equal(context.segments[0]!.arrivalAt, "2026-09-02T11:00:00.000Z");
    assert.equal(context.segments[1]!.departureAt, "2026-09-02T11:30:00.000Z");
    assert.ok(
      context.segments.flatMap((segment) => segment.warnings).some((value) => /Déšť/.test(value))
    );
  });

  it("does not call a provider or invent values outside the forecast window", async () => {
    const plan = routedPlan();
    plan.departureAt = "2026-10-02T10:00:00.000Z";
    let calls = 0;
    const context = await buildPlanTemporalContext(
      plan,
      "osm",
      async () => {
        calls += 1;
        return [];
      },
      new Date("2026-09-02T09:00:00.000Z")
    );
    assert.equal(calls, 0);
    assert.equal(context.weather.status, "out-of-range");
    assert.deepEqual(context.stops, []);
    assert.equal(context.dataBudget.upstreamWeatherRequests, 0);
  });
});
