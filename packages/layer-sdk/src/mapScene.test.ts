import test from "node:test";
import assert from "node:assert/strict";
import { isMapResultArtifact, type MapResultArtifact } from "./mapScene.js";
const artifact: MapResultArtifact = {
  schema: "mapos.map-result",
  schemaVersion: "1.0.0",
  id: "a",
  conversationId: "c",
  runId: "r",
  revision: 1,
  title: "Oblast s otvorem",
  style: { palette: "blue", opacity: 0.5, minimum: 0, maximum: 100 },
  legend: { title: "Měření", unit: "%", time: "2026", noDataLabel: "Bez dat" },
  sources: [{ id: "source", label: "Ověřený zdroj" }],
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "region",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 0]
            ],
            [
              [0.5, 0.5],
              [1, 0.5],
              [1, 1],
              [0.5, 0.5]
            ]
          ]
        },
        properties: { title: "Region", sourceId: "source", value: null }
      }
    ]
  }
};
test("map artifact preserves polygon holes and explicit no-data with provenance", () => {
  assert.equal(isMapResultArtifact(artifact), true);
  assert.equal(artifact.data.features[0]!.geometry.type, "Polygon");
});
test("artifact rejects unsupported geometry, invalid rings, unsourced data and invalid scales", () => {
  const clone = () => structuredClone(artifact);
  let a = clone();
  a.data.features[0]!.properties.sourceId = "invented";
  assert.equal(isMapResultArtifact(a), false);
  a = clone();
  a.style.midpoint = 200;
  assert.equal(isMapResultArtifact(a), false);
  a = clone();
  a.data.features[0]!.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ]
    ]
  };
  assert.equal(isMapResultArtifact(a), false);
  a = clone();
  a.data.features[0]!.properties.value = Number.NaN;
  assert.equal(isMapResultArtifact(a), false);
  a = clone();
  a.data.features[0]!.properties.value = 20;
  delete a.legend;
  assert.equal(isMapResultArtifact(a), false);
});

test("map snapshot validates display fields and bounded filters without granting access", async () => {
  const { isMapContextSnapshot } = await import("./mapScene.js");
  const state = {
    schema: "mapos.map-context",
    schemaVersion: "1.0.0",
    revision: 3,
    basemapId: "carto-dark",
    view: { longitude: -4.42, latitude: 36.72, zoom: 12 },
    layers: { "osm-poi": { visible: true, opacity: 0.7, filters: { categories: ["cafe"] } } },
    time: "2026-09-24T21:00:00Z",
    areaId: null,
    selectedFeatureIds: [],
    planRevision: 5
  };
  assert.equal(isMapContextSnapshot(state), true);
  assert.equal(isMapContextSnapshot({ ...state, bbox: [-4, 91, 5, 95] }), false);
  assert.equal(isMapContextSnapshot({ ...state, time: "invented" }), false);
  assert.equal(
    isMapContextSnapshot({ ...state, layers: { x: { visible: true, opacity: 2, filters: {} } } }),
    false
  );
  assert.equal(
    isMapContextSnapshot({
      ...state,
      layers: { x: { visible: true, opacity: 1, filters: { nested: { unknown: true } } } }
    }),
    false
  );
});

test("registered raster references reject arbitrary URLs, unknown layers and fake sampled values", () => {
  const raster = {
    ...artifact,
    registeredRaster: { layerId: "dark-sky" },
    data: { type: "FeatureCollection", features: [] },
    style: { palette: "blue", opacity: 0.6 }
  };
  assert.equal(isMapResultArtifact(raster), true);
  assert.equal(
    isMapResultArtifact({ ...raster, registeredRaster: { layerId: "private-layer" } }),
    false
  );
  assert.equal(
    isMapResultArtifact({
      ...raster,
      registeredRaster: { layerId: "dark-sky", url: "https://untrusted.example/tiles" }
    }),
    false
  );
  assert.equal(isMapResultArtifact({ ...raster, data: artifact.data }), false);
  assert.equal(isMapResultArtifact({ ...raster, style: artifact.style }), false);
  assert.equal(isMapResultArtifact({ ...raster, legend: undefined }), false);
});
