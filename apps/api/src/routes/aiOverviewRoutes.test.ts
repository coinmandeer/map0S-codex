import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAiOverviewRoutes } from "./aiOverviewRoutes.js";
import { OverviewService } from "../services/ai/overviewService.js";
import { assertOverviewEvent } from "@mapos/layer-sdk";
test("overview auth, canonical target, source override denial and terminal wire validation", async () => {
  const app = Fastify();
  let calls = 0;
  registerAiOverviewRoutes(app, {
    resolveUserId: (req) => (req.headers.authorization ? "owner" : null),
    allowedLayerIds: new Set(["osm-poi"]),
    overview: new OverviewService({
      detail: async () => {
        calls++;
        throw new Error("unavailable");
      }
    })
  });
  const body = {
    target: { type: "coordinate", lng: 14.4, lat: 50.1 },
    consent: { externalModel: false }
  };
  try {
    assert.equal(
      (await app.inject({ method: "POST", url: "/v2/ai/overview", payload: body })).statusCode,
      401
    );
    const inject = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v2/ai/overview",
        headers: { authorization: "test" },
        payload
      });
    assert.equal((await inject({ ...body, sourceOverride: "pretend public" })).statusCode, 400);
    // Public pin fields are accepted as bounded evidence, but they cannot choose a source.
    assert.equal(
      (await inject({ ...body, facts: "opening_hours: 9-17|website: https://example.com" }))
        .statusCode,
      200
    );
    assert.equal(
      (await inject({ ...body, target: { type: "poi", layerId: "private", featureId: "123" } }))
        .statusCode,
      403
    );
    assert.equal(
      (
        await inject({
          ...body,
          target: { type: "area", areaId: "missing", boundaryRevision: "rev" }
        })
      ).statusCode,
      409
    );
    const response = await inject(body);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store, no-transform");
    const events = response.body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    events.forEach(assertOverviewEvent);
    assert.equal(events.at(-1).type, "partial");
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});
test("snapshot removal requires owner authentication and does not remove another owner record", async () => {
  const app = Fastify();
  const id = "00000000-0000-4000-8000-000000000001";
  let removed = false;
  registerAiOverviewRoutes(app, {
    resolveUserId: (req) => (req.headers.authorization as string) ?? null,
    allowedLayerIds: new Set(),
    overview: new OverviewService({
      detail: async () => {
        throw new Error("not needed");
      }
    }),
    overviewSnapshots: {
      save: async () => id,
      list: async () => [],
      get: async () => null,
      remove: async (owner, key) => {
        if (owner !== "owner" || key !== id) return false;
        removed = true;
        return true;
      }
    }
  });
  try {
    assert.equal(
      (await app.inject({ method: "DELETE", url: `/v2/ai/overview/snapshots/${id}` })).statusCode,
      401
    );
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/v2/ai/overview/snapshots/${id}`,
          headers: { authorization: "other" }
        })
      ).statusCode,
      404
    );
    assert.equal(removed, false);
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/v2/ai/overview/snapshots/${id}`,
          headers: { authorization: "owner" }
        })
      ).statusCode,
      200
    );
    assert.equal(removed, true);
  } finally {
    await app.close();
  }
});
