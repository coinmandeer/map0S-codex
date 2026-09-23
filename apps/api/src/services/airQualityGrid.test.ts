import assert from "node:assert/strict";
import test from "node:test";
import { airCells, readAirValues, createAirQualityGrid } from "./airQualityGrid.js";
import type { fetchJson } from "../utils/upstream.js";
const units = { pm2_5: "μg/m³", pm10: "μg/m³", european_aqi: "EAQI" };
const hour = Date.parse("2026-09-07T12:00:00Z") / 1000;
test("air grids bound input locations, retain stable cell identities and declare actual domain", () => {
  for (const bbox of [
    [-180, -85, 180, 85],
    [-20, 35, 40, 70],
    [1, 41, 2, 42],
    [14.4, 50, 14.5, 50.1]
  ] as [number, number, number, number][]) {
    const grid = airCells(bbox);
    assert.ok(grid.cells.length <= 48 && grid.cells.length > 0);
    assert.equal(new Set(grid.cells.map((c) => c.id)).size, grid.cells.length);
  }
  assert.deepEqual(airCells([1.31, 41.11, 1.35, 41.15]), airCells([1.32, 41.12, 1.36, 41.16]));
  assert.equal(airCells([140, 35, 141, 36]).domain, "cams_global");
  assert.throws(() => airCells([1, 50, 0, 51]));
});
test("model time and null/zero values remain distinct", () => {
  assert.deepEqual(
    readAirValues(
      {
        hourly_units: units,
        hourly: { time: [hour], pm2_5: [0], pm10: [null], european_aqi: [-1] }
      },
      hour
    ),
    { pm2_5: 0, pm10: null, european_aqi: null }
  );
  assert.deepEqual(
    readAirValues(
      {
        hourly_units: units,
        hourly: { time: [hour - 3600], pm2_5: [10], pm10: [20], european_aqi: [30] }
      },
      hour
    ),
    { pm2_5: null, pm10: null, european_aqi: null }
  );
});
test("one request obtains all pollutants and neighbouring viewport reuses stable cells", async () => {
  const calls: URL[] = [];
  const load = createAirQualityGrid(
    (async (url: string) => {
      const query = new URL(url);
      calls.push(query);
      return query.searchParams
        .get("latitude")!
        .split(",")
        .map(() => ({
          hourly_units: units,
          hourly: { time: [hour], pm2_5: [8], pm10: [20], european_aqi: [30] }
        }));
    }) as typeof fetchJson,
    () => hour * 1000
  );
  const first = await load([1.31, 41.11, 1.35, 41.15]);
  const second = await load([1.32, 41.12, 1.36, 41.16]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.searchParams.get("domains"), "cams_europe");
  assert.equal(calls[0]!.searchParams.get("hourly"), "pm2_5,pm10,european_aqi");
  assert.equal(second.inputLocations, 0);
  assert.deepEqual(first.cells, second.cells);
  assert.equal(first.validAt, "2026-09-07T12:00:00.000Z");
});
test("incomplete response arrays fail instead of matching data to the wrong coordinate", async () => {
  const load = createAirQualityGrid(
    (async () => []) as unknown as typeof fetchJson,
    () => hour * 1000
  );
  await assert.rejects(load([1.31, 41.11, 1.35, 41.15]), /incomplete/);
});
test("missing model hours are partial and not cached as an empty success", async () => {
  let calls = 0;
  const load = createAirQualityGrid(
    (async () => {
      calls++;
      return { hourly_units: units, hourly: { time: [] } };
    }) as typeof fetchJson,
    () => hour * 1000
  );
  assert.equal((await load([1.31, 41.11, 1.35, 41.15])).status, "partial");
  await load([1.31, 41.11, 1.35, 41.15]);
  assert.equal(calls, 2);
});
