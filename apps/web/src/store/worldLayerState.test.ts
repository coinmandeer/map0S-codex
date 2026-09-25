import test from "node:test";
import assert from "node:assert/strict";
import { readWorldLayers, writeWorldLayers } from "./worldLayerState";
test("world stacks are isolated, deliberately empty stacks persist, sensitive filter values are omitted", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    }
  };
  assert.equal(readWorldLayers(storage, "real"), null);
  writeWorldLayers(storage, "real", {
    weather: { visible: true, opacity: 0.5, filters: { model: "test", lat: 50 } }
  });
  writeWorldLayers(storage, "aavegotchi", {});
  assert.deepEqual(readWorldLayers(storage, "aavegotchi"), {});
  assert.deepEqual(readWorldLayers(storage, "real"), {
    weather: { visible: true, selected: true, opacity: 0.5, filters: { model: "test" } }
  });
});
