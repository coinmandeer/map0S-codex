import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";
import { operationalTelemetry } from "./operationalTelemetry.js";
import { registerRequestTelemetry } from "./requestTelemetry.js";
import {
  __resetUpstreamCache,
  __setUpstreamTestDependencies,
  fetchJson
} from "../utils/upstream.js";

afterEach(() => {
  operationalTelemetry.clear();
  __resetUpstreamCache();
});

test("X-Request-ID stays correlated with an asynchronous provider trace", async () => {
  const requestIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ];
  let nextRequestId = 0;
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (url) => {
      await new Promise((resolve) => setTimeout(resolve, url.pathname.endsWith("/one") ? 10 : 1));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  });

  const app = Fastify({ logger: false, genReqId: () => requestIds[nextRequestId++]! });
  registerRequestTelemetry(app, operationalTelemetry);
  app.get("/one", async () =>
    fetchJson("https://example.test/one", { providerId: "trace-one", ttlMs: 0 })
  );
  app.get("/two", async () =>
    fetchJson("https://example.test/two", { providerId: "trace-two", ttlMs: 0 })
  );

  const [one, two] = await Promise.all([app.inject({ url: "/one" }), app.inject({ url: "/two" })]);
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200);
  const oneHeader = one.headers["x-request-id"];
  const twoHeader = two.headers["x-request-id"];
  assert.equal(oneHeader, requestIds[0]);
  assert.equal(twoHeader, requestIds[1]);

  const traces = operationalTelemetry.snapshot().providerTraces;
  assert.equal(traces.find((trace) => trace.provider === "trace-one")?.correlationId, oneHeader);
  assert.equal(traces.find((trace) => trace.provider === "trace-two")?.correlationId, twoHeader);
  await app.close();
});
