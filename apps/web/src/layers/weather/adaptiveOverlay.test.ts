import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weatherGridFeatures } from "./adaptiveOverlay.js";
import type { WeatherGrid } from "./grid.js";

const grid: WeatherGrid = {
  variable: "temperature",
  label: "Teplota",
  unit: "°C",
  bbox: [13, 49, 15, 51],
  cols: 4,
  rows: 3,
  values: [1, 2, 3, 4, 5, 6, null, 8, 9, 10, 11, 12],
  min: 1,
  max: 12,
  median: 6,
  sampleCount: 11,
  validAt: "2026-09-01T12:00:00.000Z",
  generatedAt: "2026-09-01T12:00:00.000Z"
};

describe("adaptive weather features", () => {
  it("uses no vector features for the regional continuous representation", () => {
    assert.deepEqual(
      weatherGridFeatures(grid, {
        representation: "continuous-grid",
        maxRenderedCells: 0,
        maxNumericLabels: 0
      }),
      { type: "FeatureCollection", features: [] }
    );
  });

  it("builds bounded coloured cells and preserves upstream nulls as gaps", () => {
    const result = weatherGridFeatures(grid, {
      representation: "cells",
      maxRenderedCells: 6,
      maxNumericLabels: 0
    });
    assert.ok(result.features.length <= 6);
    assert.ok(result.features.every(({ properties }) => properties.kind === "sector"));
    assert.ok(result.features.every(({ properties }) => properties.value !== 0));
  });

  it("renders local values in one GeoJSON symbol contract, not DOM markers", () => {
    const result = weatherGridFeatures(grid, {
      representation: "numeric-sectors",
      maxRenderedCells: 8,
      maxNumericLabels: 4
    });
    const sectors = result.features.filter(({ properties }) => properties.kind === "sector");
    const labels = result.features.filter(({ properties }) => properties.kind === "label");
    assert.ok(sectors.length <= 8);
    assert.ok(labels.length <= 4);
    assert.ok(labels.every(({ geometry }) => geometry.type === "Point"));
    assert.ok(labels.every(({ properties }) => properties.label.endsWith(" °C")));
  });
});
