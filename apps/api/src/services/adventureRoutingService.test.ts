import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type Place, type PlanDocumentV2, type Position } from "@mapos/layer-sdk";
import type { AdjacentRouteProvider } from "./segmentRoutingService.js";
import {
  ADVENTURE_ALGORITHM_VERSION,
  buildAdventureCorridors,
  distanceMeters,
  recommendAdventureRoute
} from "./adventureRoutingService.js";

function plan(): PlanDocumentV2 {
  const result = planV1ToV2(
    {
      id: "adventure-plan",
      name: "Deterministic adventure",
      departureAt: "2026-09-02T12:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "from", name: "From", lng: 14, lat: 50, dwellMinutes: 0 },
        { id: "to", name: "To", lng: 14.1, lat: 50, dwellMinutes: 0 }
      ],
      vehicle: { profile: "bike" },
      visibility: "private"
    },
    { now: "2026-09-02T12:00:00.000Z" }
  );
  result.routePolicy.preference = "adventure";
  return result;
}

function place(
  id: string,
  name: string,
  category: Place["category"],
  lng: number,
  lat: number
): Place {
  return {
    id,
    name,
    category,
    lng,
    lat,
    sources: [
      { source: "osm", sourceRef: id, confidence: 0.75, refreshedAt: "2026-09-02T12:00:00.000Z" }
    ]
  };
}

function provider(): { value: AdjacentRouteProvider; calls: Array<readonly [Position, Position]> } {
  const calls: Array<readonly [Position, Position]> = [];
  return {
    calls,
    value: {
      id: "deterministic-road-fixture",
      async route(request) {
        calls.push(request.endpoints);
        return {
          alternatives: [
            {
              geometry: { type: "LineString", coordinates: [...request.endpoints] },
              distanceM: Math.round(distanceMeters(...request.endpoints)),
              durationS: 600
            }
          ]
        };
      }
    }
  };
}

describe("adventure route recommendation", () => {
  it("publishes its deterministic score and keeps actual routed detours below the cap", async () => {
    const routeProvider = provider();
    const input = plan();
    const search = {
      places: [
        place("viewpoint-on-route", "Vyhlídka u cesty", "viewpoint", 14.05, 50.002),
        place("museum-on-route", "Muzeum u cesty", "museum", 14.045, 50.002),
        place("castle-far", "Hrad s velkou zajížďkou", "castle", 14.05, 50.08)
      ],
      sourceStates: [{ source: "osm", state: "ready", count: 3 }]
    };

    const first = await recommendAdventureRoute(input, search, routeProvider.value, {
      detourLimitPercent: 15,
      maximumSuggestions: 2
    });
    const second = await recommendAdventureRoute(input, search, provider().value, {
      detourLimitPercent: 15,
      maximumSuggestions: 2
    });

    assert.equal(first.algorithm.version, ADVENTURE_ALGORITHM_VERSION);
    assert.equal(first.algorithm.deterministic, true);
    assert.match(first.algorithm.formula, /0\.55/);
    assert.ok(first.suggestions.length > 0);
    assert.deepEqual(first.suggestions, second.suggestions);
    assert.equal(first.suggestions[0]?.name, "Vyhlídka u cesty");
    assert.ok(first.suggestions.every((candidate) => candidate.detourPercent <= 15));
    assert.ok(first.suggestions.every((candidate) => candidate.source.id === "osm"));
    assert.ok(routeProvider.calls.length <= 25);
    assert.equal(first.dataBudget.maxRoutedCandidates, 12);
    assert.equal(first.dataBudget.maxReturnedSuggestions, 3);
  });

  it("scans no more than six longest segments and keeps their original order", () => {
    const input = planV1ToV2(
      {
        id: "many-segments",
        name: "Many segments",
        departureAt: "2026-09-02T12:00:00.000Z",
        variant: "fast",
        stops: Array.from({ length: 10 }, (_, index) => ({
          id: `stop-${index}`,
          name: `Stop ${index}`,
          lng: 14 + index * (index === 5 ? 0.05 : 0.01),
          lat: 50,
          dwellMinutes: 0
        })),
        vehicle: { profile: "car" },
        visibility: "private"
      },
      { now: "2026-09-02T12:00:00.000Z" }
    );
    const corridors = buildAdventureCorridors(input, 10);
    assert.equal(corridors.length, 6);
    assert.deepEqual(
      corridors.map((corridor) => corridor.segmentIndex),
      [...corridors.map((corridor) => corridor.segmentIndex)].sort((a, b) => a - b)
    );
  });
});
