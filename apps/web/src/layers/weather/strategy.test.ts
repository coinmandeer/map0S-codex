import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWeatherZoomStrategy,
  WEATHER_RENDER_BUDGETS,
  WEATHER_RUNTIME_BUDGET,
  weatherUpdatePlan
} from "./strategy.js";

describe("zoom-adaptive weather strategy", () => {
  it("keeps fields smooth when zooming in and adds local numeric labels", () => {
    assert.equal(resolveWeatherZoomStrategy(4, 1200, 800).representation, "continuous-grid");
    assert.equal(resolveWeatherZoomStrategy(7, 1200, 800).representation, "smooth-field");
    assert.equal(resolveWeatherZoomStrategy(9, 1200, 800).targetCellAreaKm2, 10);
    assert.equal(resolveWeatherZoomStrategy(12, 1200, 800).representation, "smooth-field");
    assert.equal(resolveWeatherZoomStrategy(12, 1200, 800).targetCellAreaKm2, 10);
  });

  it("keeps every viewport request and rendered label set inside explicit budgets", () => {
    for (const budget of WEATHER_RENDER_BUDGETS) {
      const strategy = resolveWeatherZoomStrategy(budget.minZoom, 390, 844);
      assert.ok(strategy.cols * strategy.rows <= budget.maxGridSamples);
      assert.ok(strategy.cols * strategy.rows <= WEATHER_RUNTIME_BUDGET.maxGridSamplesPerRequest);
      assert.ok(
        budget.maxNumericLabels <= budget.maxRenderedCells || budget.maxRenderedCells === 0
      );
    }
  });

  it("uses viewport area for the local 10 km² target without exceeding the cap", () => {
    const local = resolveWeatherZoomStrategy(12, 900, 900, [0, 0, 0.3, 0.3]);
    assert.equal(local.targetCellAreaKm2, 10);
    assert.ok(local.plannedCellAreaKm2 !== null);
    assert.ok(local.plannedCellAreaKm2! >= 9 && local.plannedCellAreaKm2! <= 13);
    assert.ok(local.cols * local.rows <= local.maxGridSamples);
  });

  it("plans no provider work while inactive and never stacks radar with a numeric grid", () => {
    assert.equal(
      weatherUpdatePlan({
        active: false,
        filters: { visualization: "temperature" },
        zoom: 8,
        viewportWidth: 400,
        viewportHeight: 800
      }).kind,
      "inactive"
    );
    assert.equal(
      weatherUpdatePlan({
        active: true,
        filters: { visualization: "radar" },
        zoom: 8,
        viewportWidth: 400,
        viewportHeight: 800
      }).kind,
      "radar"
    );
    const grid = weatherUpdatePlan({
      active: true,
      filters: { variable: "wind", radar: true },
      zoom: 4,
      viewportWidth: 400,
      viewportHeight: 800
    });
    assert.equal(grid.kind, "grid");
    if (grid.kind === "grid") assert.equal(grid.animateWind, true);
  });

  it("does not issue live radar work for a future cursor", () => {
    assert.deepEqual(
      weatherUpdatePlan({
        active: true,
        filters: { visualization: "radar", at: "2026-09-08T12:00:00.000Z" },
        zoom: 6,
        viewportWidth: 800,
        viewportHeight: 600,
        nowMs: Date.parse("2026-09-01T12:00:00.000Z")
      }),
      { kind: "unavailable", visualization: "radar", reason: "radar-has-no-forecast" }
    );
  });
});
