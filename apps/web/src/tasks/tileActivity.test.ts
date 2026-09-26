import assert from "node:assert/strict";
import test from "node:test";
import type maplibregl from "maplibre-gl";
import { watchLayerTiles } from "./tileActivity";

function fakeMap(sources: Record<string, { type: string }>) {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  let styleReads = 0;
  const map = {
    getStyle() {
      styleReads++;
      return { sources };
    },
    getSource: (id: string) => sources[id],
    isSourceLoaded: () => false,
    on(type: string, handler: (event: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    off(type: string, handler: (event: unknown) => void) {
      handlers.get(type)?.delete(handler);
    }
  };
  const fire = (type: string, event: unknown = {}) =>
    handlers.get(type)?.forEach((handler) => handler(event));
  return { map: map as unknown as maplibregl.Map, fire, styleReads: () => styleReads, handlers };
}

test("basemap tile events never make a layer's watcher read the whole style", () => {
  const sources: Record<string, { type: string }> = {
    basemap: { type: "vector" },
    "source-tile-radar": { type: "raster" }
  };
  const { map, fire, styleReads, handlers } = fakeMap(sources);
  const stop = watchLayerTiles(map, "radar", 1, () => {});
  const initial = styleReads();
  for (let i = 0; i < 500; i++)
    fire("sourcedata", { sourceId: "basemap", sourceDataType: "content", coord: { i } });
  for (let i = 0; i < 20; i++)
    fire("sourcedata", { sourceId: "source-tile-radar", sourceDataType: "content", coord: { i } });
  assert.equal(styleReads(), initial, "the source list is cached between tile events");

  // A source the layer adds later is picked up by its first event.
  sources["source-tile-radar-2"] = { type: "raster" };
  fire("sourcedata", { sourceId: "source-tile-radar-2", sourceDataType: "metadata" });
  assert.equal(styleReads(), initial + 1);
  fire("styledata");
  fire("idle");
  assert.equal(styleReads(), initial + 2, "a style change refreshes the list once");

  stop();
  assert.equal(
    [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    0
  );
});
