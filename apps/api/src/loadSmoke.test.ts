import assert from "node:assert/strict";
import test from "node:test";
import { buildMemoryApp } from "./memory-server.js";

const OFFLINE_LAYER_REQUESTS = [
  "/weather/grid?bbox=13,49,14,50&variable=wind&cols=3&rows=2",
  "/info/weather?lng=14&lat=50",
  "/discover/guide?bbox=13.2,49.6,13.5,49.9&lang=cs",
  "/mapy/suggest?q=Plze%C5%88",
  "/v2/discover/context?lng=13.3775&lat=49.7475&zoom=11",
  "/v2/layers/events/features?bbox=13,49,14,50",
  "/v2/events?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z",
  "/layers",
  "/config",
  "/health"
] as const;

function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

test("offline fixture profile sustains 1/5/10 active-module request batches within a finite budget", async (t) => {
  const app = await buildMemoryApp({ offlineFixture: true });
  t.after(() => app.close());
  const durations: number[] = [];
  let responseBytes = 0;

  for (const activeCount of [1, 5, 10]) {
    for (let viewport = 0; viewport < 8; viewport += 1) {
      const started = performance.now();
      const responses = await Promise.all(
        OFFLINE_LAYER_REQUESTS.slice(0, activeCount).map((url) =>
          app.inject({ method: "GET", url })
        )
      );
      durations.push(performance.now() - started);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body.slice(0, 200));
        responseBytes += Buffer.byteLength(response.body);
      }
    }
  }

  assert.equal(durations.length, 24);
  assert.ok(percentile(durations, 0.95) < 1_000, `offline p95 ${percentile(durations, 0.95)}ms`);
  assert.ok(responseBytes < 8 * 1024 * 1024, `offline payload ${responseBytes} bytes`);
});
