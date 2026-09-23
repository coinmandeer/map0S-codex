import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlaceSources } from "@mapos/layer-sdk";
import {
  clearPresetBaseline,
  readPresetBaseline,
  writePresetBaseline,
  type PresetBaseline
} from "./presetBaseline.js";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key)
  };
}

const baseline: PresetBaseline = {
  id: "user:weekend",
  appearance: {
    layers: {
      "osm-poi": { visible: true, selected: true, opacity: 1, filters: { categories: ["castle"] } }
    },
    basemapId: "carto-voyager",
    basemapLabels: true,
    buildings3d: false,
    terrain3d: false,
    poiSources: defaultPlaceSources()
  }
};

describe("preset baseline", () => {
  it("round-trips the applied config so a reload can still recognise it", () => {
    const storage = memoryStorage();
    writePresetBaseline(storage, baseline);
    assert.deepEqual(readPresetBaseline(storage), baseline);
  });

  it("returns nothing for absent, malformed or unrelated storage", () => {
    assert.equal(readPresetBaseline(null), null);
    const storage = memoryStorage();
    storage.setItem("mapos:preset-baseline-v1", "{not json");
    assert.equal(readPresetBaseline(storage), null);
    storage.setItem("mapos:preset-baseline-v1", JSON.stringify({ id: "user:x" }));
    assert.equal(readPresetBaseline(storage), null, "a baseline without an appearance is unusable");
  });

  it("clears when the user releases the preset", () => {
    const storage = memoryStorage();
    writePresetBaseline(storage, baseline);
    clearPresetBaseline(storage);
    assert.equal(readPresetBaseline(storage), null);
  });

  it("survives denied storage without throwing", () => {
    const denied = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      }
    };
    writePresetBaseline(denied, baseline);
    clearPresetBaseline(denied);
    assert.equal(readPresetBaseline(denied), null);
  });
});
