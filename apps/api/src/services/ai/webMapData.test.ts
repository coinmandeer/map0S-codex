import assert from "node:assert/strict";
import test from "node:test";
import { isMapResultArtifact } from "@mapos/layer-sdk";
import { webMapData } from "./webMapData.js";
const places = new Map([
  [
    "geocode:a",
    {
      id: "geocode:a",
      layerId: "osm-poi",
      title: "Obec A, Česká republika",
      category: "geocoded-place",
      longitude: 14,
      latitude: 50,
      sourceId: "geocoder"
    }
  ]
]);
const pages = new Map([["https://data.example/table", "Index 2024, body. Obec A: 12,5 bodů."]]);
const data = {
  title: "Index",
  unit: "body",
  time: "2024",
  rows: [
    {
      placeId: "geocode:a",
      placeName: "Obec A",
      value: 12.5,
      sourceUrl: "https://data.example/table",
      quote: "Obec A: 12,5 bodů."
    }
  ]
};
test("web numbers use retrieved evidence, original values and geocoder coordinates", () => {
  const result = webMapData(data, places, pages);
  assert.ok(result);
  assert.ok(
    isMapResultArtifact({
      ...result,
      schema: "mapos.map-result",
      schemaVersion: "1.0.0",
      conversationId: "c",
      runId: "r",
      revision: 1
    })
  );
  assert.equal(result.data.features[0]?.properties.value, 12.5);
  assert.deepEqual(result.data.features[0]?.geometry.coordinates, [14, 50]);
});
test("rejects fabricated IDs, quotations, numbers, periods and sources atomically", () => {
  for (const change of [
    { placeId: "fake" },
    { quote: "Obec A: 99 bodů." },
    { value: 2 },
    { sourceUrl: "https://other.example" },
    { placeName: "Obec B" }
  ])
    assert.equal(
      webMapData({ ...data, rows: [{ ...data.rows[0], ...change }] }, places, pages),
      null
    );
  assert.equal(webMapData({ ...data, time: "2025" }, places, pages), null);
  assert.equal(webMapData({ ...data, unit: "EUR" }, places, pages), null);
});
