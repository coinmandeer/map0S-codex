import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import { CLIMATE_PERIOD, monthlyClimateNormals } from "./climateService.js";

/**
 * The climate normals are aggregated from a 30-year daily series. These tests are about the
 * aggregation being right and the endpoint never turning a failure into invented numbers.
 */

beforeEach(() => {
  __resetUpstreamCache();
  __setUpstreamTestDependencies({});
  mock.restoreAll();
});

function stubArchive(days: Array<{ time: string; min: number | null; max: number | null }>) {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          daily: {
            time: days.map((day) => day.time),
            temperature_2m_min: days.map((day) => day.min),
            temperature_2m_max: days.map((day) => day.max)
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
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
}

test("aggregates daily values into twelve monthly normals", async () => {
  stubArchive([
    { time: "1995-01-01", min: -2, max: 2 },
    { time: "1995-01-02", min: -4, max: 0 },
    { time: "2010-07-01", min: 14, max: 24 },
    { time: "2010-07-02", min: 16, max: 26 }
  ]);

  const climate = await monthlyClimateNormals(14.42, 50.08);
  assert.equal(climate.status, "ready");
  assert.equal(climate.period, CLIMATE_PERIOD);
  assert.equal(climate.normals.length, 12);
  assert.equal(climate.normals[0]!.min, -3);
  assert.equal(climate.normals[0]!.max, 1);
  assert.equal(climate.normals[6]!.min, 15);
  assert.equal(climate.normals[6]!.max, 25);
  assert.equal(climate.normals[0]!.samples, 2);
});

test("skips missing days instead of treating them as zero", async () => {
  stubArchive([
    { time: "1995-03-01", min: -2, max: 2 },
    { time: "1995-03-02", min: null, max: null },
    { time: "1995-03-03", min: 0, max: 4 }
  ]);

  const climate = await monthlyClimateNormals(14.42, 50.08);
  assert.equal(climate.normals[2]!.min, -1);
  assert.equal(climate.normals[2]!.samples, 2);
});

test("a malformed or empty response yields unavailable, never guesses", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ daily: { time: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
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

  const climate = await monthlyClimateNormals(14.42, 50.08);
  assert.equal(climate.status, "unavailable");
  assert.deepEqual(climate.normals, []);
  assert.equal(climate.source, null);
});

test("an upstream failure is unavailable rather than an exception", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
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

  const climate = await monthlyClimateNormals(14.42, 50.08);
  assert.equal(climate.status, "unavailable");
  assert.equal(climate.normals.length, 0);
});
