import assert from "node:assert/strict";
import test from "node:test";
import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "@mapos/layer-sdk";
import { createPinsLayerHandle } from "./pinsLayer";

test("point-only layers allocate no line source; routes allocate lazily and release when removed", () => {
  const sources = new Map<string, { setData(data: FeatureCollection): void }>();
  const layers = new Map<string, maplibregl.LayerSpecification & { before?: string }>();
  const commits: string[] = [];
  const map = {
    hasImage: () => true,
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: (id: string) =>
      sources.set(id, {
        setData: () => {
          commits.push(id);
        }
      }),
    addLayer: (layer: maplibregl.LayerSpecification, before?: string) =>
      layers.set(layer.id, { ...layer, before }),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: () => {},
    setPaintProperty: () => {}
  } as unknown as maplibregl.Map;
  const handle = createPinsLayerHandle(map, "/api", "test", "#123456");
  const points: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "point", name: "Point", layerId: "test" },
        geometry: { type: "Point", coordinates: [14, 50] }
      }
    ]
  };
  handle.setData(points);
  handle.setData(points);
  assert.deepEqual([...sources.keys()], ["source-test"]);
  assert.deepEqual(commits, ["source-test", "source-test"]);
  handle.setVisible(false);
  handle.setOpacity(0.4);
  const routes: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "route", name: "Route", layerId: "test", anchorLng: 14, anchorLat: 50 },
        geometry: {
          type: "LineString",
          coordinates: [
            [14, 50],
            [15, 51]
          ]
        }
      }
    ]
  };
  handle.setData(routes);
  assert.ok(sources.has("source-test-lines"));
  assert.equal(
    (layers.get("pins-test-line")! as maplibregl.LineLayerSpecification & { before?: string })
      .before,
    "pins-test-cluster"
  );
  assert.equal(
    (layers.get("pins-test-line")! as maplibregl.LineLayerSpecification & { before?: string })
      .layout!.visibility,
    "none"
  );
  assert.equal(
    (layers.get("pins-test-line")! as maplibregl.LineLayerSpecification & { before?: string })
      .paint!["line-opacity"],
    0.9 * 0.4
  );
  handle.setData(points);
  assert.equal(sources.has("source-test-lines"), false);
  assert.equal(layers.has("pins-test-line"), false);
  handle.setData(routes);
  assert.ok(sources.has("source-test-lines"));
  handle.detach();
  assert.equal(sources.size, 0);
  assert.equal(layers.size, 0);
});
