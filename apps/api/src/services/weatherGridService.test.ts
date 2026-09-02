import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import {
  fetchWeatherGrid,
  isWeatherVariable,
  MAX_GRID_POINTS,
  WEATHER_VARIABLES
} from "./weatherGridService.js";

const BBOX: [number, number, number, number] = [12, 48, 16, 51];

function stubOpenMeteo(points: number, sample: Record<string, number>) {
  const calls: string[] = [];
  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);
  const time = hour.toISOString().slice(0, 16);
  const hourly = Object.fromEntries([
    ["time", [time]],
    ...Object.entries(sample).map(([field, value]) => [field, [value]])
  ]);
  mock.method(globalThis, "fetch", async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify(Array.from({ length: points }, () => ({ hourly }))), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
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
  return calls;
}

test.afterEach(() => {
  mock.restoreAll();
  __resetUpstreamCache();
});

test("a scalar grid is fetched in one request and shaped row-major", async () => {
  const calls = stubOpenMeteo(999, { temperature_2m: 17.5 });
  const grid = await fetchWeatherGrid({ bbox: BBOX, variable: "temperature", cols: 5, rows: 4 });

  assert.equal(calls.length, 1, "the whole grid must cost a single upstream call");
  assert.equal(grid.values.length, 5 * 4);
  assert.equal(grid.unit, "°C");
  assert.equal(grid.min, 17.5);
  assert.equal(grid.max, 17.5);
  assert.equal(grid.median, 17.5);
  assert.equal(grid.sampleCount, 20);
  assert.equal(grid.u, undefined, "scalars carry no flow components");
});

test("wind direction becomes u/v components pointing where the wind blows to", async () => {
  stubOpenMeteo(999, { wind_speed_10m: 10, wind_direction_10m: 270 });
  const grid = await fetchWeatherGrid({ bbox: BBOX, variable: "wind", cols: 3, rows: 3 });

  // A westerly (from 270°) blows eastward: +u, ~0 v.
  assert.ok(grid.u && grid.v);
  assert.ok(Math.abs(grid.u![0]! - 10) < 0.001, `expected u≈10, got ${grid.u![0]}`);
  assert.ok(Math.abs(grid.v![0]!) < 0.001, `expected v≈0, got ${grid.v![0]}`);
});

test("the same viewport is served from cache instead of re-querying", async () => {
  const calls = stubOpenMeteo(999, { temperature_2m: 3 });
  await fetchWeatherGrid({ bbox: BBOX, variable: "temperature", cols: 4, rows: 4 });
  await fetchWeatherGrid({ bbox: BBOX, variable: "temperature", cols: 4, rows: 4 });
  assert.equal(calls.length, 1);
});

test("nearby viewports snap onto the same grid so panning is free", async () => {
  const calls = stubOpenMeteo(999, { temperature_2m: 3 });
  await fetchWeatherGrid({ bbox: [12.2, 48.2, 16.2, 51.2], variable: "clouds", cols: 4, rows: 4 });
  await fetchWeatherGrid({
    bbox: [12.21, 48.21, 16.21, 51.21],
    variable: "clouds",
    cols: 4,
    rows: 4
  });
  assert.equal(calls.length, 1);
});

test("grid size is capped so one pan can never fan out into a huge request", async () => {
  stubOpenMeteo(9999, { temperature_2m: 1 });
  const grid = await fetchWeatherGrid({
    bbox: BBOX,
    variable: "temperature",
    cols: 500,
    rows: 500
  });
  assert.ok(grid.cols * grid.rows <= MAX_GRID_POINTS, `got ${grid.cols}x${grid.rows}`);
});

test("missing upstream values stay null rather than becoming zero", async () => {
  stubOpenMeteo(9, { wind_direction_10m: 90 });
  const grid = await fetchWeatherGrid({ bbox: [1, 41, 5, 44], variable: "wind", cols: 3, rows: 3 });
  assert.equal(grid.values[0], null);
  assert.equal(grid.u![0], null);
});

test("only known variables are accepted", () => {
  assert.ok(isWeatherVariable("wind"));
  assert.ok(!isWeatherVariable("rain_of_frogs"));
  for (const spec of Object.values(WEATHER_VARIABLES)) {
    assert.ok(spec.fields.length > 0 && spec.unit.length > 0);
  }
});
