import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { viewportCoverage, viewportDrift } from "./viewportCoverage.js";

const BOX: Bbox = [0, 0, 1, 1];

function point(lng: number, lat: number): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id: `${lng},${lat}`, name: "x", layerId: "test" }
  };
}

describe("viewportDrift", () => {
  it("is nearly nothing for a nudge and about a screen for a screen", () => {
    assert.ok(viewportDrift(BOX, [0.02, 0.02, 1.02, 1.02]) < 0.1);
    // Panned one full viewport east: the previous answer covers none of what is on screen.
    assert.ok(viewportDrift(BOX, [1, 0, 2, 1]) >= 0.9);
  });

  it("counts a zoom change as movement in both directions", () => {
    // Zoomed out to four times the span, and in to a quarter: both are a different question.
    assert.ok(viewportDrift(BOX, [-1.5, -1.5, 2.5, 2.5]) > 1);
    assert.ok(viewportDrift(BOX, [0.375, 0.375, 0.625, 0.625]) > 1);
  });
});

describe("viewportCoverage", () => {
  it("is zero without features and for features outside the viewport", () => {
    assert.equal(viewportCoverage([], BOX), 0);
    assert.equal(viewportCoverage([point(5, 5)], BOX), 0);
  });

  it("reads a crowded corner as mostly empty, because that is what it looks like", () => {
    // Two hundred pins down one street cover one cell of twenty-five, not the screen.
    const crowd = Array.from({ length: 200 }, (_, index) => point(0.05, 0.05 + index * 0.00005));
    assert.equal(viewportCoverage(crowd, BOX), 1 / 25);
  });

  it("rises as features spread across the grid", () => {
    const spread: GeoFeature[] = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        spread.push(point(0.1 + column * 0.2, 0.1 + row * 0.2));
      }
    }
    assert.equal(viewportCoverage(spread, BOX), 1);
  });

  it("credits every cell a line passes through, not just where it starts", () => {
    const line: GeoFeature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0.1, 0.5],
          [0.5, 0.5],
          [0.9, 0.5]
        ]
      },
      properties: { id: "line", name: "route", layerId: "test" }
    };
    assert.equal(viewportCoverage([line], BOX), 3 / 25);
  });
});
