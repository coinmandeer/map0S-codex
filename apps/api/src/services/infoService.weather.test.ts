import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import { getPointForecast } from "./infoService.js";

test.afterEach(() => {
  mock.restoreAll();
  __resetUpstreamCache();
});

test("point weather keeps the seven-day forecast separate from the ERA5 climate normals", async () => {
  const requested: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    // The archive adapter asks a different endpoint for the 1991–2020 normals.
    if (url.includes("archive-api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          daily: {
            time: ["1995-01-01", "1995-01-02", "1995-07-01"],
            temperature_2m_min: [-2, -4, 14],
            temperature_2m_max: [2, 0, 24]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
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

  // Forecast and climate are two requests: one seven-day forecast, one 30-year archive.
  const forecastUrl = requested.find((url) => url.includes("forecast_days=7"));
  assert.ok(forecastUrl, "the seven-day forecast must be requested");
  assert.ok(
    requested.some((url) => url.includes("archive-api.open-meteo.com")),
    "climate normals must come from the archive adapter, not the forecast"
  );
  assert.equal(result.daily.length, 7);
  assert.equal(result.source.id, "open-meteo-forecast");
  assert.equal(result.source.license, "CC BY 4.0");
  assert.equal(result.climate.status, "ready");
  assert.equal(result.climate.period, "1991-2020");
  assert.equal(result.climate.normals[0]?.min, -3);
  assert.equal(result.climate.normals[0]?.max, 1);
  assert.equal(result.climate.normals[6]?.min, 14);
  assert.equal(result.climate.source?.id, "open-meteo-era5");
  assert.equal(result.hourly[1]?.temperature, null, "missing upstream data must not become 0 °C");
});
