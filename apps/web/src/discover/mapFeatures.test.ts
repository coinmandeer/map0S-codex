import assert from "node:assert/strict";
import test from "node:test";
import type { GeoFeature } from "@mapos/layer-sdk";
import { discoverMapFeatures } from "./mapFeatures";

function point(id: string, name: string, lng: number): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, 50] },
    properties: { id, name, category: "viewpoint", layerId: "shown" }
  };
}

test("lists only already-visible layer features, nearest first", () => {
  const result = discoverMapFeatures(
    { shown: { visible: true }, hidden: { visible: false } },
    {
      shown: [point("far", "Daleko", 14), point("near", "Blízko", 13.01)],
      hidden: [point("hidden", "Skryté", 13)]
    },
    { lng: 13, lat: 50, zoom: 12 }
  );

  assert.deepEqual(
    result.map(({ feature, layerId }) => [layerId, feature.properties.id]),
    [
      ["shown", "near"],
      ["shown", "far"]
    ]
  );
});

test("caps the accessibility companion without starting another query", () => {
  const result = discoverMapFeatures(
    { places: { visible: true } },
    { places: [point("a", "A", 13), point("b", "B", 13.1)] },
    { lng: 13, lat: 50, zoom: 12 },
    1
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, "A");
});
