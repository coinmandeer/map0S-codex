import assert from "node:assert/strict";
import { test } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import { fetchRoute, fetchRouteAlternatives } from "./routingService.js";

test("fetchRoute returns coordinates without depending on the public OSRM service", async (t) => {
  let requested = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        routes: [
          {
            distance: 640,
            duration: 510,
            geometry: {
              coordinates: [
                [13.3775, 49.7475],
                [13.38, 49.749],
                [13.382, 49.7505]
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  });
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal
      })
  });
  t.after(() => __resetUpstreamCache());

  const route = await fetchRoute("13.3775,49.7475", "13.382,49.7505", "foot", {
    waypoints: ["13.38,49.749"]
  });
  assert.ok(route.coordinates.length > 1);
  assert.ok(route.distanceM > 0);
  assert.ok(route.durationS > 0);
  assert.match(requested, /13\.3775,49\.7475;13\.38,49\.749;13\.382,49\.7505/);
  assert.match(requested, /alternatives=false/);
  assert.match(requested, /skip_waypoints=true/);
});

test("fetchRouteAlternatives requests at most two ranked OSRM routes", async (t) => {
  let requested = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        routes: [
          {
            distance: 640,
            duration: 510,
            geometry: {
              coordinates: [
                [13.37, 49.74],
                [13.38, 49.75]
              ]
            }
          },
          {
            distance: 710,
            duration: 560,
            geometry: {
              coordinates: [
                [13.37, 49.74],
                [13.375, 49.755],
                [13.38, 49.75]
              ]
            }
          },
          {
            distance: 900,
            duration: 700,
            geometry: {
              coordinates: [
                [13.37, 49.74],
                [13.38, 49.75]
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  });
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal
      })
  });
  t.after(() => __resetUpstreamCache());

  const routes = await fetchRouteAlternatives("13.37,49.74", "13.38,49.75", "bike", {
    alternatives: 9
  });
  assert.equal(routes.length, 2);
  assert.equal(routes[1]?.distanceM, 710);
  assert.match(requested, /alternatives=2/);
});
