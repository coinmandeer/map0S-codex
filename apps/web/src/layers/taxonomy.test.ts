import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allLayerPlugins, getLayerPlugin } from "./registry";
import { isStructuralTileOverlayId, STRUCTURAL_TILE_OVERLAY_IDS } from "./plugins/tileLayers";
import "./builtins";

describe("layer and surface taxonomy", () => {
  it("classifies every keyless raster map as a structural additive overlay", () => {
    assert.deepEqual(
      [...STRUCTURAL_TILE_OVERLAY_IDS],
      ["cyclosm", "waymarked-trails", "openrailwaymap", "openseamap", "opentopomap", "opensnowmap"]
    );

    for (const id of STRUCTURAL_TILE_OVERLAY_IDS) {
      const plugin = getLayerPlugin(id);
      assert.ok(plugin, `${id} must stay registered`);
      assert.equal(plugin.kind, "raster");
      assert.equal(plugin.manifest.modes, undefined);
      assert.equal(plugin.manifest.primaryForModes, undefined);
    }
  });

  it("keeps structural overlays out of Layers while weather and events remain there", () => {
    const plugins = allLayerPlugins();
    const basemapDrawer = plugins.filter((plugin) => isStructuralTileOverlayId(plugin.manifest.id));
    const layersDrawer = plugins.filter((plugin) => !isStructuralTileOverlayId(plugin.manifest.id));

    assert.deepEqual(
      basemapDrawer.map((plugin) => plugin.manifest.id),
      [...STRUCTURAL_TILE_OVERLAY_IDS]
    );
    assert.ok(layersDrawer.some((plugin) => plugin.manifest.id === "weather"));
    assert.ok(layersDrawer.some((plugin) => plugin.manifest.id === "events"));
    assert.ok(
      !layersDrawer.some((plugin) => isStructuralTileOverlayId(plugin.manifest.id)),
      "a structural overlay must not be duplicated in Layers"
    );
  });

  it("does not let weather claim a shell mode or primary-mode slot", () => {
    const weather = getLayerPlugin("weather")!;
    assert.equal(weather.manifest.modes, undefined);
    assert.equal(weather.manifest.primaryForModes, undefined);
  });
});
