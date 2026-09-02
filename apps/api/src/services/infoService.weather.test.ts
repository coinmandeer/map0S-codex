import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import { getPointForecast } from "./infoService.js";

test.afterEach(() => {
  mock.restoreAll();
  __resetUpstreamCache();
});

test("point weather keeps seven-day forecast separate from gated climate records", async () => {
  const requested: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({
        current: {
          temperature_2m: 18.5,
          wind_speed_10m: 12,
          wind_direction_10m: 270,
          weather_code: 2
        },
        hourly: {
          time: ["2026-09-01T12:00", "2026-09-01T13:00"],
          temperature_2m: [18.5],
          precipitation: [0, 0.2],
          weather_code: [2, 3]
        },
        daily: {
          time: Array.from(
            { length: 9 },
            (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`
          ),
          temperature_2m_min: Array.from({ length: 9 }, () => 12),
          temperature_2m_max: Array.from({ length: 9 }, () => 22),
          precipitation_sum: Array.from({ length: 9 }, () => 0),
          weather_code: Array.from({ length: 9 }, () => 1)
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
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

  const result = await getPointForecast(14.4378, 50.0755);

  assert.equal(requested.length, 1);
  assert.match(requested[0]!, /forecast_days=7/);
  assert.equal(result.daily.length, 7);
  assert.equal(result.source.id, "open-meteo-forecast");
  assert.equal(result.source.license, "CC BY 4.0");
  assert.deepEqual(result.climate, {
    status: "unavailable",
    normals: [],
    extremes: [],
    source: null,
    gate: "climate-provider-not-configured",
    reason: "Klimatické normály a historické extrémy vyžadují samostatný ověřený historický zdroj."
  });
  assert.equal(result.hourly[1]?.temperature, null, "missing upstream data must not become 0 °C");
});
