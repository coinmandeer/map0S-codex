import assert from "node:assert/strict";
import { it } from "node:test";
import type maplibregl from "maplibre-gl";
import { layerActivity, mapActivitySummary } from "./layerActivity";
import { watchLayerTiles } from "./tileActivity";
it("does not call a failed or waiting map current", () => {
  layerActivity.state("bad", "error");
  assert.match(mapActivitySummary([layerActivity.get("bad")]), /nejsou dostupné/);
  layerActivity.state("bad", "pending");
  assert.match(mapActivitySummary([layerActivity.get("bad")]), /Hledat zde/);
});
it("observes structural child sources, isolates other sources and cleans listeners", () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let ready = false;
  const map = {
    getStyle: () => ({ sources: { "source-tile-trails-cycling": { type: "raster" } } }),
    getSource: () => ({}),
    isSourceLoaded: () => ready,
    on: (name: string, callback: (...args: unknown[]) => void) => handlers.set(name, callback),
    off: (name: string) => handlers.delete(name)
  } as unknown as maplibregl.Map;
  const generation = layerActivity.begin("trails");
  const dispose = watchLayerTiles(map, "trails", generation, () => {});
  assert.equal(layerActivity.get("trails")?.phase, "loading");
  handlers.get("error")?.({ sourceId: "unrelated" });
  handlers.get("sourcedata")?.({
    sourceId: "source-tile-trails-cycling",
    sourceDataType: "content",
    coord: { z: 12, x: 1, y: 1 }
  });
  ready = true;
  handlers.get("idle")?.();
  assert.equal(layerActivity.get("trails")?.phase, "ready");
  assert.equal(layerActivity.get("trails")?.count, 1);
  dispose();
  assert.equal(handlers.size, 0);
});
it("pan does not recover an outage without successful current content", () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const sourceId = "source-tile-outage";
  const map = {
    getStyle: () => ({ sources: { [sourceId]: { type: "raster" } } }),
    getSource: () => ({}),
    isSourceLoaded: () => true,
    on: (name: string, callback: (...args: unknown[]) => void) => handlers.set(name, callback),
    off: (name: string) => handlers.delete(name)
  } as unknown as maplibregl.Map;
  const generation = layerActivity.begin("outage");
  const dispose = watchLayerTiles(map, "outage", generation, () => {});
  handlers.get("error")?.({ sourceId, coord: { z: 12, x: 1, y: 1 } });
  assert.equal(layerActivity.get("outage")?.phase, "error");
  handlers.get("movestart")?.();
  handlers.get("idle")?.();
  assert.equal(layerActivity.get("outage")?.phase, "error");
  handlers.get("sourcedata")?.({
    sourceId,
    sourceDataType: "content",
    coord: { z: 12, x: 2, y: 1 }
  });
  assert.equal(layerActivity.get("outage")?.phase, "ready");
  dispose();
});
it("timeout stays terminal until a new viewport generation", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let ready = false;
  const sourceId = "source-tile-timeout";
  const map = {
    getStyle: () => ({ sources: { [sourceId]: { type: "raster" } } }),
    getSource: () => ({}),
    isSourceLoaded: () => ready,
    on: (name: string, callback: (...args: unknown[]) => void) => handlers.set(name, callback),
    off: (name: string) => handlers.delete(name)
  } as unknown as maplibregl.Map;
  const generation = layerActivity.begin("timeout");
  const dispose = watchLayerTiles(map, "timeout", generation, () => {});
  context.mock.timers.tick(30001);
  assert.equal(layerActivity.get("timeout")?.phase, "error");
  handlers.get("idle")?.();
  assert.equal(layerActivity.get("timeout")?.phase, "error");
  handlers.get("movestart")?.();
  handlers.get("idle")?.();
  assert.equal(layerActivity.get("timeout")?.phase, "loading");
  ready = true;
  handlers.get("sourcedata")?.({
    sourceId,
    sourceDataType: "content",
    coord: { z: 12, x: 2, y: 1 }
  });
  assert.equal(layerActivity.get("timeout")?.phase, "ready");
  dispose();
  context.mock.timers.reset();
});
