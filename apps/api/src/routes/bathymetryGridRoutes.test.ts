import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerBathymetryGridRoutes } from "./bathymetryGridRoutes.js";

test("unpublished numeric bathymetry is explicit and never probes an upstream", async (t) => {
  const app = Fastify({ logger: false });
  registerBathymetryGridRoutes(app);
  t.after(() => app.close());
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected upstream");
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const result = await app.inject("/environment/bathymetry/grid?bbox=0,39,3,42&cols=8&rows=6");
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().code, "bathymetry-numeric-data-pending");
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(calls, 0);
  assert.equal((await app.inject("/environment/bathymetry/grid?bbox=3,39,0,42")).statusCode, 400);
});
