import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeatureCollection, LayerHandle } from "@mapos/layer-sdk";
import { MapLibreDataLayerLifecycle } from "./maplibreLifecycle.js";

class FakeMap {
  private listener: (() => void) | undefined;
  on(_event: "style.load", listener: () => void) {
    this.listener = listener;
  }
  off(_event: "style.load", listener: () => void) {
    if (this.listener === listener) this.listener = undefined;
  }
  reloadStyle() {
    this.listener?.();
  }
}

const data: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.4, 50.1] },
      properties: { id: "one", name: "One", layerId: "fixture" }
    }
  ]
};

describe("MapLibreDataLayerLifecycle", () => {
  it("keeps a stable handle and restores cached desired state after style.load", async () => {
    const map = new FakeMap();
    const calls: Array<{ kind: string; generation: number; value?: unknown }> = [];
    let generation = 0;
    const create = (): LayerHandle => {
      const current = ++generation;
      calls.push({ kind: "create", generation: current });
      return {
        update: async () => data,
        setData: (value) => calls.push({ kind: "data", generation: current, value }),
        setVisible: (value) => calls.push({ kind: "visible", generation: current, value }),
        setOpacity: (value) => calls.push({ kind: "opacity", generation: current, value }),
        detach: () => calls.push({ kind: "detach", generation: current })
      };
    };

    const lifecycle = new MapLibreDataLayerLifecycle(map as never);
    const stable = lifecycle.attach({ id: "fixture", create });
    await stable.update([-1, -1, 1, 1], {});
    stable.setVisible(false);
    stable.setOpacity(0.4);
    map.reloadStyle();

    assert.equal(generation, 2);
    assert.ok(calls.some((call) => call.kind === "data" && call.generation === 2));
    assert.ok(
      calls.some((call) => call.kind === "visible" && call.generation === 2 && call.value === false)
    );
    assert.ok(
      calls.some((call) => call.kind === "opacity" && call.generation === 2 && call.value === 0.4)
    );

    stable.detach();
    assert.equal(lifecycle.has("fixture"), false);
    lifecycle.destroy();
  });
});
