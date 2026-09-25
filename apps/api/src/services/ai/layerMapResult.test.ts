import test from "node:test";
import assert from "node:assert/strict";
import { layerMapResult } from "./layerMapResult.js";
import { point } from "../dataSources/types.js";

test("registered aurora output carries source grid polygons, zero and no-data with a numeric legend", () => {
  const row = (id: string, probability: unknown) =>
    point(id, id, 10, 60, "aurora", {
      probability,
      cellBounds: [9, 59, 11, 61],
      forecastAt: "2026-09-24T21:00:00Z"
    });
  const result = layerMapResult("aurora", [row("zero", 0), row("missing", undefined)], 10)!;
  assert.equal(result.data.features.length, 2);
  assert.equal(result.data.features[0]!.geometry.type, "Polygon");
  assert.equal(result.data.features[0]!.properties.value, 0);
  assert.equal(result.data.features[1]!.properties.value, null);
  assert.equal(result.legend?.unit, "%");
  assert.equal(result.legend?.time, "2026-09-24T21:00:00Z");
  assert.equal(layerMapResult("unregistered", [row("x", 1)], 10), undefined);
  assert.equal(layerMapResult("dark-sky", [row("x", 1)], 10), undefined);
});

test("GDACS artifacts preserve sourced polygon holes, stable categories and reject invalid rings", () => {
  const rings = [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 0]
    ],
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 1]
    ]
  ];
  const row = point("event", "Event", 2, 2, "disaster-impacts", {
    alert: "Red",
    footprints: [
      { geometry: { type: "Polygon", coordinates: rings }, label: "Impact" },
      {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1]
            ]
          ]
        }
      }
    ]
  });
  const result = layerMapResult("disaster-impacts", [row], 1)!;
  assert.equal(result.data.features.length, 2);
  assert.deepEqual(result.data.features[1]!.geometry, { type: "Polygon", coordinates: rings });
  assert.equal(result.data.features[1]!.properties.category, "Red");
  assert.equal(result.sources[0]!.id, "layer:disaster-impacts");
});
