import assert from "node:assert/strict";
import test from "node:test";
import type { Position } from "@mapos/layer-sdk";
import type { RouteResult } from "./routingService.js";
import { createAdjacentRouteProvider } from "./adjacentRouteProvider.js";

const endpoints: [Position, Position] = [
  [14.4, 50.1],
  [14.5, 50.2]
];

function result(provider: "osm" | "mapy", profile: string): RouteResult {
  return {
    provider,
    profile,
    coordinates: endpoints.map((point) => [...point] as Position),
    distanceM: 1_000,
    durationS: 120
  };
}

test("Mapy short maps to car_short without a fabricated warning", async () => {
  const calls: Array<{ profile: string; avoidToll: boolean | undefined }> = [];
  const provider = createAdjacentRouteProvider("mapy", async (_from, _to, profile, options) => {
    calls.push({ profile: profile ?? "foot", avoidToll: options?.avoidToll });
    return [result("mapy", profile ?? "foot")];
  });
  const response = await provider.route({
    endpoints,
    profile: "car",
    preference: "short",
    avoid: []
  });

  assert.deepEqual(calls, [{ profile: "car_short", avoidToll: false }]);
  assert.deepEqual(response.alternatives[0]?.warnings, []);
});

test("unsupported no-highways and vehicle constraints use an explicit bounded fallback", async () => {
  const calls: Array<{ profile: string; avoidToll: boolean | undefined }> = [];
  const provider = createAdjacentRouteProvider("mapy", async (_from, _to, profile, options) => {
    calls.push({ profile: profile ?? "foot", avoidToll: options?.avoidToll });
    return [result("mapy", profile ?? "foot")];
  });
  const response = await provider.route({
    endpoints,
    profile: "camper",
    preference: "nohwy",
    avoid: ["motorways"]
  });

  assert.deepEqual(calls, [{ profile: "car_fast_traffic", avoidToll: true }]);
  const warnings = response.alternatives[0]?.warnings?.join(" ") ?? "";
  assert.match(warnings, /rozměrová omezení/);
  assert.match(warnings, /negarantuje vynechání dálnic/);
});

test("runtime provider fallback remains visible alongside capability fallback", async () => {
  const provider = createAdjacentRouteProvider("mapy", async () => [result("osm", "car")]);
  const response = await provider.route({
    endpoints,
    profile: "car",
    preference: "short",
    avoid: []
  });

  const warnings = response.alternatives[0]?.warnings?.join(" ") ?? "";
  assert.match(warnings, /OSM\/OSRM nepodporuje profil short/);
  assert.match(warnings, /segment použil osm/);
});

test("an adventurous ride is routed by BRouter's mtb profile, with its elevation", async () => {
  const asked: Array<{ profile: string; points: readonly string[] }> = [];
  const provider = createAdjacentRouteProvider("osm", {
    routeFetcher: async () => {
      throw new Error("the plan provider must not be asked for an adventure");
    },
    brouterFetcher: async (request) => {
      asked.push({ profile: request.profile, points: request.points });
      return [
        {
          coordinates: endpoints.map((point) => [...point] as [number, number]),
          distanceM: 1_450,
          durationS: 320,
          elevation: [310, 348]
        }
      ];
    }
  });

  const response = await provider.route({
    endpoints,
    profile: "bike",
    preference: "adventure",
    avoid: []
  });

  assert.deepEqual(asked, [{ profile: "mtb", points: ["14.4,50.1", "14.5,50.2"] }]);
  assert.equal(response.alternatives.length, 1);
  assert.equal(response.alternatives[0]?.profile, "mtb");
  assert.equal(response.alternatives[0]?.distanceM, 1_450);
  assert.deepEqual(response.alternatives[0]?.warnings, [], "a native profile has nothing to warn");
});

test("a BRouter outage falls back to the plan's provider and says so", async () => {
  const provider = createAdjacentRouteProvider("osm", {
    routeFetcher: async (_from, _to, profile) => [result("osm", profile ?? "foot")],
    brouterFetcher: async () => {
      throw new Error("brouter is down");
    }
  });

  const response = await provider.route({
    endpoints,
    profile: "foot",
    preference: "adventure",
    avoid: []
  });

  assert.equal(response.alternatives[0]?.profile, "foot", "the asked-for way of travelling stays");
  assert.match(response.alternatives[0]?.warnings?.join(" ") ?? "", /BRouter nebyl dostupný/);
});

test("keeps bounded provider alternatives in recommendation order", async () => {
  const second = {
    ...result("osm", "bike"),
    coordinates: [endpoints[0], [14.46, 50.16] as Position, endpoints[1]],
    distanceM: 1_180,
    durationS: 145
  };
  const provider = createAdjacentRouteProvider("osm", async (_from, _to, _profile, options) => {
    assert.equal(options?.alternatives, 2);
    return [result("osm", "bike"), second];
  });
  const response = await provider.route({
    endpoints,
    profile: "bike",
    preference: "fast",
    avoid: []
  });

  assert.equal(response.alternatives.length, 2);
  assert.equal(response.alternatives[0]?.id, "provider-route-1");
  assert.equal(response.alternatives[1]?.distanceM, 1_180);
  assert.match(response.alternatives[1]?.warnings?.join(" ") ?? "", /Alternativní trasa/);
});
