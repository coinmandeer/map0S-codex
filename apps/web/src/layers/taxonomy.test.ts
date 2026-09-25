import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODE_MANIFESTS } from "../product/registry";
import { allLayerPlugins, getLayerPlugin, primaryLayerForAppMode } from "./registry";
import { STRUCTURAL_TILE_OVERLAY_IDS } from "./plugins/tileLayers";
import "./builtins";

describe("layer and surface taxonomy", () => {
  it("classifies every keyless raster map as a structural additive overlay", () => {
    assert.deepEqual(
      [...STRUCTURAL_TILE_OVERLAY_IDS],
      ["cyclosm", "waymarked-trails", "openrailwaymap", "openseamap", "opensnowmap"]
    );

    for (const id of STRUCTURAL_TILE_OVERLAY_IDS) {
      const plugin = getLayerPlugin(id);
      assert.ok(plugin, `${id} must stay registered`);
      assert.equal(plugin.kind, "raster");
      assert.equal(plugin.manifest.modes, undefined);
      assert.equal(plugin.manifest.primaryForModes, undefined);
    }
  });

  it("offers structural overlays through Layers, never through Basemaps", () => {
    const plugins = allLayerPlugins();
    // The five keyless raster overlays stay registered and additive — they simply moved from the
    // Basemaps drawer into the matching Layers categories (§2.2, §2.4).
    for (const id of STRUCTURAL_TILE_OVERLAY_IDS) {
      assert.ok(
        plugins.some((plugin) => plugin.manifest.id === id),
        `${id} must stay registered after the move`
      );
    }
    assert.ok(
      plugins.some((plugin) => plugin.manifest.id === "weather-radar"),
      "weather belongs to Layers"
    );
    assert.ok(
      plugins.some((plugin) => plugin.manifest.id === "events"),
      "events belongs to Layers"
    );
  });

  it("gives every shell mode a primary layer, Feed included", () => {
    for (const { id } of MODE_MANIFESTS) {
      const primary = primaryLayerForAppMode(id);
      assert.ok(getLayerPlugin(primary), `mode "${id}" points at a layer that is registered`);
    }
    // Feed lists user pins, so the layer it opens with has to be the one those pins render in;
    // anything else and tapping a post would fly to an empty map.
    assert.equal(primaryLayerForAppMode("feed"), "user-layers");
  });

  it("does not let weather claim a shell mode or primary-mode slot", () => {
    for (const id of ["weather-radar", "weather-temperature", "weather-wind"]) {
      const weather = getLayerPlugin(id)!;
      assert.equal(weather.manifest.modes, undefined);
      assert.equal(weather.manifest.primaryForModes, undefined);
    }
  });
});
