import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { OperationalTelemetry } from "../observability/operationalTelemetry.js";
import { registerOperationalRoutes } from "./operationalRoutes.js";

test("operations endpoints fail closed and expose only redacted telemetry with a bearer token", async () => {
  const telemetry = new OperationalTelemetry();
  telemetry.recordRequest({ method: "GET", route: "/places/:id", statusCode: 200, durationMs: 4 });
  const app = Fastify({ logger: false });
  registerOperationalRoutes(app, {
    token: "a".repeat(32),
    telemetry,
    circuits: () => []
  });
  assert.equal((await app.inject({ url: "/internal/status" })).statusCode, 401);
  const response = await app.inject({
    url: "/internal/metrics",
    headers: { authorization: `Bearer ${"a".repeat(32)}` }
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/plain/);
  assert.match(response.body, /route="\/places\/:id"/);
  assert.doesNotMatch(response.body, /authorization|bearer|aaaaaaaa/iu);
  await app.close();
});

test("operations endpoints are indistinguishable from absent when no token is configured", async () => {
  const app = Fastify({ logger: false });
  registerOperationalRoutes(app, {
    telemetry: new OperationalTelemetry(),
    circuits: () => []
  });
  assert.equal((await app.inject({ url: "/internal/status" })).statusCode, 404);
  await app.close();
});
