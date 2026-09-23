import test from "node:test";
import assert from "node:assert/strict";
import type maplibregl from "maplibre-gl";
import { BASEMAPS } from "@mapos/layer-sdk";
import { CZECH_LAYERS, czechTileUrl, inCzechBounds } from "./czechSources";
import { useInverseCadastre } from "./czechLayers";
import { getLayerPlugin } from "../registry";

test("Czech WMS requests use the existing adapter and preserve raw MapLibre bounds", () => {
  for (const def of CZECH_LAYERS) {
    const raw = czechTileUrl(def);
    const url = new URL(raw);
    assert.equal(url.searchParams.get("crs"), "EPSG:3857");
    assert.equal(url.searchParams.get("layers"), def.layers.join(","));
    assert.ok(raw.endsWith("bbox={bbox-epsg-3857}"));
    assert.equal(url.hostname.includes("mapee"), false);
  }
  const def = CZECH_LAYERS.find((d) => d.id === "cz-cadastre")!;
  assert.equal(new URL(czechTileUrl(def, true)).searchParams.get("layers"), "KN_I");
  assert.equal(useInverseCadastre("dark", "carto-voyager"), true);
  assert.equal(useInverseCadastre("light", "cuzk-ortofoto"), true);
  assert.equal(useInverseCadastre("light", "carto-voyager"), false);
  assert.equal(inCzechBounds(14.42, 50.08), true);
  assert.equal(inCzechBounds(13.4, 52.5), false);
  assert.ok(BASEMAPS.find((b) => b.id === "cuzk-ortofoto")?.bounds);
});

test("network selection replaces tiles, preserves opacity, clears empty selection and cannot revive after detach", async () => {
  const sources = new Map<string, { tiles: string[] }>();
  const layers = new Map<
    string,
    { minzoom: number; paint: Record<string, number>; layout: Record<string, string> }
  >();
  const map = {
    getStyle: () => ({ layers: [] }),
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: (id: string, source: { tiles: string[] }) => sources.set(id, source),
    addLayer: (layer: {
      id: string;
      minzoom: number;
      paint: Record<string, number>;
      layout: Record<string, string>;
    }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: (id: string, key: string, value: string) => {
      layers.get(id)!.layout[key] = value;
    },
    setPaintProperty: (id: string, key: string, value: number) => {
      layers.get(id)!.paint[key] = value;
    }
  } as unknown as maplibregl.Map;
  const plugin = getLayerPlugin("cz-networks")!;
  const handle = plugin.create({ map, apiBaseUrl: "", layerId: "cz-networks", color: "" });
  const bbox: [number, number, number, number] = [14, 50, 15, 51];
  handle.setOpacity(0.35);
  await handle.update(bbox, { networks: ["voda"] });
  const requestLayers = () =>
    new URL([...sources.values()][0]!.tiles[0]!).searchParams.get("layers");
  assert.equal(requestLayers(), "voda");
  await handle.update(bbox, { networks: ["plyn"] });
  assert.equal(requestLayers(), "plyn");
  assert.equal([...layers.values()][0]?.paint["raster-opacity"], 0.35);
  assert.equal([...layers.values()][0]?.minzoom, 14);
  await handle.update(bbox, { networks: [] });
  assert.equal(sources.size, 0);
  handle.detach();
  await handle.update(bbox, { networks: ["voda"] });
  assert.equal(sources.size, 0);
});
