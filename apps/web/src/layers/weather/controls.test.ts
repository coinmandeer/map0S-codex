import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWeatherVisualization,
  WEATHER_VISUALIZATIONS,
  weatherVisualizationFilters
} from "./controls.js";

describe("weather visualization controls", () => {
  it("exposes one unique option for radar and each numeric variable", () => {
    assert.deepEqual(
      WEATHER_VISUALIZATIONS.map(({ id }) => id),
      ["radar", "precipitation", "temperature", "wind", "gusts", "clouds", "pressure", "humidity"]
    );
    assert.equal(new Set(WEATHER_VISUALIZATIONS.map(({ id }) => id)).size, 8);
  });

  it("migrates the old variable plus implicit-radar shape to the variable", () => {
    assert.equal(resolveWeatherVisualization({ variable: "wind", radar: true }), "wind");
    assert.equal(resolveWeatherVisualization({ radar: true }), "radar");
    assert.equal(resolveWeatherVisualization({}), "radar");
  });

  it("writes mutually exclusive legacy-compatible filters", () => {
    assert.deepEqual(weatherVisualizationFilters({ at: "now" }, "temperature"), {
      at: "now",
      visualization: "temperature",
      radar: false,
      variable: "temperature"
    });
    assert.deepEqual(weatherVisualizationFilters({ at: "now", variable: "wind" }, "radar"), {
      at: "now",
      visualization: "radar",
      radar: true,
      variable: null
    });
  });
});
