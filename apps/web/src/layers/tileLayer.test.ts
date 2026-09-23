import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type maplibregl from "maplibre-gl";
import { createTileLayer, subdomains } from "./tileLayer";

interface AddedSource {
  tiles: string[];
  attribution?: string;
  maxzoom?: number;
}

/** Just enough of MapLibre's layer/source bookkeeping to observe what the handle does. */
function fakeMap() {
  const sources = new Map<string, AddedSource>();
  const layers = new Map<string, { beforeId?: string; layout: Record<string, unknown> }>();
  const paint = new Map<string, Record<string, unknown>>();
  const addCalls: string[] = [];

  const map = {
    getStyle: () => ({
      layers: [
        { id: "base-fill", type: "fill" },
        { id: "labels", type: "symbol" }
      ]
    }),
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: (id: string, src: AddedSource) => {
      sources.set(id, src);
      addCalls.push(`source:${id}`);
    },
    addLayer: (spec: { id: string; layout?: Record<string, unknown> }, beforeId?: string) => {
      layers.set(spec.id, { beforeId, layout: spec.layout ?? {} });
      addCalls.push(`layer:${spec.id}`);
    },
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const l = layers.get(id);
      if (l) l.layout[key] = value;
    },
    setPaintProperty: (id: string, key: string, value: unknown) => {
      paint.set(id, { ...(paint.get(id) ?? {}), [key]: value });
    }
  } as unknown as maplibregl.Map;

  return { map, sources, layers, paint, addCalls };
}

const BBOX = [14, 50, 15, 51] as [number, number, number, number];

describe("tile layer factory", () => {
  it("inserts the overlay below the first symbol layer so labels and pins stay on top", async () => {
    const { map, layers } = fakeMap();
    const handle = createTileLayer(map, "cyclosm", { tiles: ["https://x/{z}/{x}/{y}.png"] });
    await handle.update(BBOX, {});

    assert.equal(layers.get("raster-tile-cyclosm")?.beforeId, "labels");
  });

  it("does not rebuild the source when nothing changed", async () => {
    const { map, addCalls } = fakeMap();
    const handle = createTileLayer(map, "t", { tiles: ["https://x/{z}/{x}/{y}.png"] });

    await handle.update(BBOX, {});
    await handle.update(BBOX, {});
    await handle.update(BBOX, {});

    // Rebuilding on every viewport refresh would drop the tile cache and make the overlay
    // flicker on every pan.
    assert.deepEqual(addCalls, ["source:source-tile-t", "layer:raster-tile-t"]);
  });

  it("swaps tiles when a filter selects a different set", async () => {
    const { map, sources } = fakeMap();
    const handle = createTileLayer(map, "trails", {
      tiles: ["https://tiles/hiking/{z}/{x}/{y}.png"],
      tilesForFilters: (f) => [`https://tiles/${String(f.activity)}/{z}/{x}/{y}.png`]
    });

    await handle.update(BBOX, { activity: "hiking" });
    assert.deepEqual(sources.get("source-tile-trails")?.tiles, [
      "https://tiles/hiking/{z}/{x}/{y}.png"
    ]);

    await handle.update(BBOX, { activity: "mtb" });
    assert.deepEqual(sources.get("source-tile-trails")?.tiles, [
      "https://tiles/mtb/{z}/{x}/{y}.png"
    ]);
  });

  it("re-creates itself after a style switch wiped the layer", async () => {
    const { map, sources, layers } = fakeMap();
    const handle = createTileLayer(map, "t", { tiles: ["https://x/{z}/{x}/{y}.png"] });
    await handle.update(BBOX, {});

    // What `setStyle` does to every runtime-added layer.
    sources.delete("source-tile-t");
    layers.delete("raster-tile-t");

    await handle.update(BBOX, {});
    assert.ok(sources.has("source-tile-t"), "the overlay should come back on the next refresh");
  });

  it("keeps visibility and opacity across a rebuild", async () => {
    const { map, layers, paint, sources } = fakeMap();
    const handle = createTileLayer(map, "t", {
      tiles: ["https://a/{z}/{x}/{y}.png"],
      tilesForFilters: (f) => [`https://${String(f.v)}/{z}/{x}/{y}.png`]
    });

    await handle.update(BBOX, { v: "a" });
    handle.setVisible(false);
    handle.setOpacity(0.4);

    await handle.update(BBOX, { v: "b" });
    assert.equal(sources.get("source-tile-t")?.tiles[0], "https://b/{z}/{x}/{y}.png");
    // A hidden layer that reappears at full opacity because a filter changed would be a
    // surprise the user never asked for.
    assert.equal(layers.get("raster-tile-t")?.layout.visibility, "none");
    assert.equal(paint.get("raster-tile-t")?.["raster-opacity"], 0.4);
  });

  it("keeps selected networks independently and removes only the deselected source", async () => {
    const { map, sources, addCalls, paint } = fakeMap();
    const handle = createTileLayer(map, "trails", {
      tiles: [],
      sourcesForFilters: (filters) =>
        (filters.activity as string[]).map((id) => ({
          id,
          tiles: [`https://tiles/${id}/{z}/{x}/{y}.png`]
        }))
    });
    await handle.update(BBOX, { activity: ["cycling", "hiking"] });
    assert.equal(sources.size, 2);
    const before = addCalls.length;
    handle.setOpacity(0.35);
    await handle.update(BBOX, { activity: ["hiking"] });
    assert.equal(addCalls.length, before);
    assert.equal(sources.has("source-tile-trails-cycling"), false);
    assert.equal(paint.get("raster-tile-trails-hiking")?.["raster-opacity"], 0.35);
    handle.detach();
    assert.equal(sources.size, 0);
  });

  it("cannot recreate later children after detach or a newer filter update", async () => {
    const { map, sources } = fakeMap();
    const handle = createTileLayer(map, "race", {
      tiles: [],
      sourcesForFilters: (filters) =>
        (filters.activity as string[]).map((id) => ({ id, tiles: [`https://tiles/${id}`] }))
    });
    const pending = handle.update(BBOX, { activity: ["cycling", "hiking"] });
    handle.detach();
    await pending;
    assert.equal(sources.size, 0);
    const next = createTileLayer(map, "race", {
      tiles: [],
      sourcesForFilters: (filters) =>
        (filters.activity as string[]).map((id) => ({ id, tiles: [`https://tiles/${id}`] }))
    });
    const old = next.update(BBOX, { activity: ["cycling", "hiking"] });
    await next.update(BBOX, { activity: ["mtb"] });
    await old;
    assert.deepEqual([...sources.keys()], ["source-tile-race-mtb"]);
    next.detach();
  });

  it("does not attach any source for an already aborted update", async () => {
    const { map, sources } = fakeMap();
    const handle = createTileLayer(map, "cancel", { tiles: ["https://tiles/x"] });
    await handle.update(BBOX, {}, AbortSignal.abort());
    assert.equal(sources.size, 0);
  });

  it("expands subdomain templates", () => {
    assert.deepEqual(subdomains("https://{s}.tile.example/{z}/{x}/{y}.png"), [
      "https://a.tile.example/{z}/{x}/{y}.png",
      "https://b.tile.example/{z}/{x}/{y}.png",
      "https://c.tile.example/{z}/{x}/{y}.png"
    ]);
  });
});
