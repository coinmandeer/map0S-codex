import assert from "node:assert/strict";
import test from "node:test";
import { GamePerformanceMonitor, evaluateGamePerformance } from "./gamePerformance";

test("low-end frame and memory budgets are explicit and independently reported", () => {
  const snapshot = evaluateGamePerformance("low", {
    frameSamplesMs: [16, 20, 24, 31, 54],
    drawCalls: 25,
    triangles: 40_000,
    estimatedGpuBytes: 49 * 1024 * 1024,
    visibleEntities: 100
  });
  assert.equal(snapshot.frameMsP50, 24);
  assert.equal(snapshot.frameMsP95, 54);
  assert.deepEqual(snapshot.violations, ["frame-p95", "draw-calls", "gpu-memory"]);
  assert.equal(snapshot.withinBudget, false);
});

test("monitor keeps a bounded rolling sample", () => {
  const monitor = new GamePerformanceMonitor(3);
  for (const frameMs of [80, 30, 20, 10]) {
    monitor.record({
      frameMs,
      drawCalls: 4,
      triangles: 12_000,
      geometries: 4,
      textures: 1,
      visibleEntities: 100
    });
  }
  const snapshot = monitor.snapshot("low");
  assert.equal(snapshot.sampleCount, 3);
  assert.equal(snapshot.frameMsP95, 30);
  assert.equal(snapshot.withinBudget, true);
});
