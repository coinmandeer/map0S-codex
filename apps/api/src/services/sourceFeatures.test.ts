import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSourceRoutes } from "../routes/sourceRoutes.js";
import { querySourceFeatures } from "./sourceFeatures.js";
import { describeSource, probeSource } from "./sourceService.js";
import { fixtureAdapterIo } from "./sourceFixtures.js";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";

async function manifest() {
  const { probe } = await probeSource(
    "https://example.arcgis/arcgis/rest/services/test/FeatureServer",
    fixtureAdapterIo
  );
  return describeSource({ probe, sublayerIds: ["0"], layerId: "stored-source" });
}
test("viewport transport reuses recent data but refreshes after thirty seconds", async (t) => {
  const value = await manifest();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let requests = 0;
  __resetUpstreamCache();
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async () => {
      requests++;
      return new Response(
        JSON.stringify({
          displayFieldName: "name",
          features: [
            {
              attributes: { OBJECTID: 1, name: `Revision ${requests}` },
              geometry: { x: 13, y: 49 }
            }
          ]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }
  });
  try {
    const query = () => querySourceFeatures(value, "stored-source", [13, 49, 14, 50]);
    const first = await query();
    assert.equal(first.query?.cacheTtlMs, 30_000);
    assert.deepEqual(await query(), first);
    assert.equal(requests, 1);
    t.mock.timers.tick(30_001);
    const refreshed = await query();
    assert.equal(requests, 2);
    assert.notDeepEqual(refreshed.features, first.features);
  } finally {
    __resetUpstreamCache();
    t.mock.timers.reset();
  }
});
test("stored FeatureServer returns points and lines with the request signal and a bounded query", async () => {
  const controller = new AbortController();
  const result = await querySourceFeatures(
    await manifest(),
    "owner-layer",
    [13, 49, 14, 50],
    controller.signal,
    {
      ...fixtureAdapterIo,
      json: async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("resultRecordCount"), "1000");
        assert.equal(parsed.searchParams.get("geometry"), "13,49,14,50");
        assert.equal(parsed.searchParams.get("inSR"), "4326");
        assert.equal(options?.signal, controller.signal);
        return fixtureAdapterIo.json(url, options);
      }
    }
  );
  assert.deepEqual(
    result.features.map((f) => f.geometry.type),
    ["Point", "LineString"]
  );
  assert.equal(result.features[0]?.properties.name, "ArcGIS místo");
  assert.equal(result.features[0]?.properties.layerId, "owner-layer");
  assert.equal(result.query?.status, "complete");
});
test("aborted request never invokes transport and unsupported stored endpoint is rejected", async () => {
  let calls = 0;
  const io = {
    ...fixtureAdapterIo,
    json: async () => {
      calls++;
      return {};
    }
  };
  const value = await manifest();
  await assert.rejects(querySourceFeatures(value, "x", [13, 49, 14, 50], AbortSignal.abort(), io));
  await assert.rejects(
    querySourceFeatures(
      { ...value, source: { ...value.source, endpoint: "http://localhost/FeatureServer/0/query" } },
      "x",
      [13, 49, 14, 50],
      undefined,
      io
    )
  );
  assert.equal(calls, 0);
});
test("upstream overflow is bounded and explicitly partial", async () => {
  const result = await querySourceFeatures(await manifest(), "x", [13, 49, 14, 50], undefined, {
    ...fixtureAdapterIo,
    json: async () => ({
      features: Array.from({ length: 1100 }, (_, id) => ({
        attributes: { OBJECTID: id },
        geometry: { x: 13, y: 49 }
      }))
    })
  });
  assert.equal(result.features.length, 1000);
  assert.equal(result.query?.truncated, true);
  assert.equal(result.query?.status, "partial");
  assert.ok(result.notice);
});
test("source route requires ownership, validates bounds, and never accepts a URL from caller", async () => {
  const app = Fastify();
  const value = await manifest();
  const seen: string[] = [];
  let calls = 0;
  registerSourceRoutes(app, {
    resolveUserId: async (req) => (req.headers.authorization === "owner" ? "alice" : null),
    loadManifest: async (id, owner) => {
      seen.push(`${owner}:${id}`);
      return id === "mine" ? value : null;
    },
    features: async () => {
      calls++;
      return { type: "FeatureCollection", features: [] };
    }
  });
  try {
    const path = "/v2/sources/layers/mine/features?bbox=13,49,14,50";
    assert.equal((await app.inject(path)).statusCode, 401);
    assert.equal(calls, 0);
    assert.equal(
      (
        await app.inject({
          url: path.replace("mine", "foreign"),
          headers: { authorization: "owner" }
        })
      ).statusCode,
      404
    );
    for (const bbox of ["13,,14,50", "0,0,100,50", "14,50,13,49", "NaN,0,1,1"]) {
      const r = await app.inject({
        url: `/v2/sources/layers/mine/features?bbox=${bbox}`,
        headers: { authorization: "owner" }
      });
      assert.ok(r.statusCode >= 400);
    }
    const response = await app.inject({ url: path, headers: { authorization: "owner" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(calls, 1);
    assert.deepEqual(seen, ["alice:foreign", "alice:mine"]);
  } finally {
    await app.close();
  }
});
