import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { FeatureCollection } from "@mapos/layer-sdk";
import type maplibregl from "maplibre-gl";
import { createVectorTileOverlay } from "./vectorTileOverlay";
import { createDataLayer } from "./dataLayer";
import { createLiveTrafficLayer } from "./plugins/liveTraffic";
import { interactivePinOwner } from "../map/interactivePins";
import { getLayerPlugin, layerUnavailableReason } from "./registry";
import "./plugins/streetObjectsLayer";

function fixture(t: TestContext) {
  type TestLayer = {
    id: string;
    type: string;
    source?: string;
    layout: Record<string, unknown>;
    paint: Record<string, unknown>;
  };
  type TestSource = { data?: FeatureCollection; setData?(data: FeatureCollection): void };
  const layers = new Map<string, TestLayer>(),
    sources = new Map<string, TestSource>(),
    images = new Set<string>();
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === "getImageData" ? () => ({}) : () => {}) }
  );
  const document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ getContext: () => context })
  };
  const beforeDocument = globalThis.document,
    beforePath = globalThis.Path2D;
  Object.assign(globalThis, { document, Path2D: class {} });
  t.after(() => Object.assign(globalThis, { document: beforeDocument, Path2D: beforePath }));
  const map = {
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    addLayer: (layer: TestLayer) => layers.set(layer.id, layer),
    addSource: (id: string, source: TestSource) =>
      sources.set(id, {
        ...source,
        setData(data: FeatureCollection) {
          this.data = data;
        }
      }),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => {
      assert.ok(
        ![...layers.values()].some((l) => l.source === id),
        "remove children before source"
      );
      sources.delete(id);
    },
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      layers.get(id)!.layout[key] = value;
    },
    setPaintProperty: (id: string, key: string, value: unknown) => {
      layers.get(id)!.paint[key] = value;
    },
    getZoom: () => 15,
    getBounds: () => ({
      getWest: () => 14,
      getEast: () => 15,
      getSouth: () => 49,
      getNorth: () => 51
    })
  } as unknown as maplibregl.Map;
  return { map, layers, sources, document };
}

test("vector pins remain clickable after style reset and detach all resources", async (t) => {
  const { map, layers, sources } = fixture(t);
  const handle = createVectorTileOverlay(map, "places", {
    tiles: ["/tiles"],
    sublayers: [
      {
        id: "place",
        type: "symbol",
        sourceLayer: "place",
        pin: { glyph: "restaurant", color: "red" },
        interactive: true,
        paint: {}
      }
    ]
  });
  await handle.update([14, 49, 15, 51], {});
  assert.equal(layers.get("vt-places-place")!.type, "symbol");
  assert.equal(interactivePinOwner(map, "vt-places-place"), "places");
  layers.clear();
  sources.clear();
  await handle.update([14, 49, 15, 51], {});
  assert.equal(layers.size, 1);
  handle.detach();
  assert.equal(layers.size, 0);
  assert.equal(sources.size, 0);
  assert.equal(interactivePinOwner(map, "vt-places-place"), undefined);
});

test("street category toggles keep other pins and detach their child layers", async (t) => {
  const { map, layers, sources } = fixture(t);
  const handle = getLayerPlugin("street-objects")!.create({
    map,
    apiBaseUrl: "/api",
    layerId: "street-objects",
    color: "red"
  });
  await handle.update([14, 49, 15, 51], { categories: ["signs", "power"] });
  assert.equal(layers.size, 2);
  assert.ok([...layers.values()].every((l) => l.type === "symbol"));
  await handle.update([14, 49, 15, 51], { categories: ["signs"] });
  assert.equal(layers.size, 1);
  handle.detach();
  assert.equal(sources.size, 0);
});

test("generic pins honor categorical colours and requested numeric sizes", (t) => {
  const { map, layers } = fixture(t);
  const handle = createDataLayer(map, "/api", "events", {
    color: "blue",
    colorBy: { property: "status", values: { cancelled: "red" } },
    sizeBy: { property: "magnitude", min: 0, max: 8, minRadius: 8, maxRadius: 24 }
  });
  handle.setVisible(true);
  const layout = layers.get("pins-events-dot")!.layout;
  assert.deepEqual(layout["icon-image"], [
    "match",
    ["to-string", ["get", "status"]],
    "cancelled",
    "pin-events-cancelled",
    "pin-events"
  ]);
  assert.deepEqual((layout["icon-size"] as unknown[]).slice(-4), [0, 0.65, 8, 1.5]);
  handle.detach();
});

test("an hour-old aircraft is dropped and vessel movement follows course, not heading", async (t) => {
  const { map, sources, document } = fixture(t);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [14, 50] },
              properties: {
                id: "old",
                seenPosSeconds: 0,
                observedAt: new Date(Date.now() - 3600_000).toISOString(),
                speedKt: 10,
                headingDeg: 0,
                courseDeg: 90
              }
            }
          ]
        })
      )
  );
  const aircraft = createLiveTrafficLayer(map, "/api", "live-aircraft", "aircraft");
  await aircraft.update([14, 49, 15, 51], {});
  await new Promise(setImmediate);
  assert.equal(sources.get("source-live-live-aircraft")!.data!.features.length, 0);
  aircraft.detach();
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [14, 50] },
              properties: {
                id: "ship",
                seenPosSeconds: 20,
                speedKt: 10,
                headingDeg: 0,
                courseDeg: 90
              }
            }
          ]
        })
      )
  );
  const vessels = createLiveTrafficLayer(map, "/api", "live-vessels", "vessels");
  await vessels.update([14, 49, 15, 51], {});
  await new Promise(setImmediate);
  const f = sources.get("source-live-live-vessels")!.data!.features[0]!;
  assert.equal(f.geometry.type, "Point");
  assert.ok(Number(f.geometry.coordinates[0]) > 14);
  assert.equal(f.properties.heading, 0);
  assert.equal(f.properties.positionMode, "estimated");
  assert.ok(Number(f.properties.fixAgeSeconds) >= 20);
  document.visibilityState = "hidden";
  vessels.detach();
});

test("configuration gates match the actual street source requirement", () => {
  assert.match(
    layerUnavailableReason("street-objects", {
      mapy: false,
      cml: false,
      cmlProvider: "none",
      owm: false,
      windy: false,
      fsq: false
    })!,
    /mapillary/
  );
  assert.equal(
    layerUnavailableReason("street-objects", {
      mapy: false,
      cml: false,
      cmlProvider: "none",
      owm: false,
      windy: false,
      fsq: false,
      mapillary: true
    }),
    undefined
  );
});

test("six and twelve data layers repeatedly release all sources and interactions", async (t) => {
  const { map, layers, sources } = fixture(t);
  for (const count of [6, 12])
    for (let cycle = 0; cycle < 10; cycle++) {
      const handles = Array.from({ length: count }, (_, i) =>
        createDataLayer(map, "/api", `load-${i}`, { color: "blue" })
      );
      for (const handle of handles) {
        handle.setVisible(true);
        handle.setData?.({
          type: "FeatureCollection",
          features: Array.from({ length: 200 }, (_, i) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [14 + i / 1000, 50] },
            properties: { id: String(i), name: `Point ${i}`, layerId: "load" }
          }))
        });
      }
      assert.equal(sources.size, count);
      for (const handle of handles) handle.detach();
      assert.equal(sources.size, 0);
      assert.equal(layers.size, 0);
    }
});
