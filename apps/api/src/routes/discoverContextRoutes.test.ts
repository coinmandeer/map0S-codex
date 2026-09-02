import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createDiscoverContextService } from "../services/discoverService.js";
import { registerDiscoverContextRoutes } from "./discoverContextRoutes.js";

test("discover context route validates the viewport and delegates to the service", async (t) => {
  const seen: Array<{ lng: number; activeLayerIds?: string[] }> = [];
  const service = createDiscoverContextService({
    resolveRegion: async (input) => {
      seen.push(input);
      return null;
    },
    resolveGuide: async () => null
  });
  const app = Fastify({ logger: false });
  registerDiscoverContextRoutes(app, { service });
  await app.ready();
  t.after(() => app.close());

  const bad = await app.inject({ method: "GET", url: "/v2/discover/context?lng=999&lat=0&zoom=5" });
  assert.equal(bad.statusCode, 400);
  assert.equal(seen.length, 0);

  const response = await app.inject({
    method: "GET",
    url: "/v2/discover/context?lng=13.37&lat=49.74&zoom=12&bbox=13,49,14,50&layers=events,weather,events"
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen[0]?.activeLayerIds, ["events", "weather"]);
  assert.equal(response.json().schemaVersion, "2.0.0");
  assert.equal(response.json().boundary.status, "dataset-required");
});
