import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run with node --import tsx scripts/weather-model-smoke.mjs for the current source tree.
// A compiled release may instead provide MAPOS_DRILL_MODULE_ROOT=/app/apps/api/dist.
const compiled = process.env.MAPOS_DRILL_MODULE_ROOT;
const modulePath = compiled
  ? resolve(compiled, "services/weatherGridService.js")
  : resolve("apps/api/src/services/weatherGridService.ts");
const { fetchWeatherGrid } = await import(pathToFileURL(modulePath).href);
const results = [];
for (const model of ["best_match", "icon_seamless", "chmi_aladin_seamless"]) {
  const started = performance.now();
  try {
    const grid = await fetchWeatherGrid({
      bbox: [14.35, 50.02, 14.48, 50.12],
      variable: "temperature",
      model,
      cols: 2,
      rows: 2,
      signal: AbortSignal.timeout(20_000)
    });
    assert.equal(grid.model, model);
    assert.ok(grid.sampleCount > 0 && grid.values.some(Number.isFinite), "No numeric samples");
    results.push({
      model,
      verified: true,
      elapsedMs: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(JSON.stringify(grid)),
      sampleCount: grid.sampleCount,
      validAt: grid.validAt,
      min: grid.min,
      max: grid.max
    });
  } catch (error) {
    results.push({
      model,
      verified: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "Unknown failure"
    });
  }
}
const verified = results.every((result) => result.verified);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      guardedTransport: true,
      verified,
      bbox: [14.35, 50.02, 14.48, 50.12],
      results,
      note: "Small Prague viewport only; does not prove complete European coverage or native resolution."
    },
    null,
    2
  )
);
if (!verified) process.exitCode = 1;
