import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLayerManifestV2, getLayerPlugin } from "../registry";
import "./roadsLayer";

/**
 * The roads overlay reads OpenMapTiles' `transportation` layer, and its filter options have to
 * name the same class values the tiles contain — a legend that promises "Dálnice" for a class the
 * schema calls something else would be a key for a map that does not exist.
 */
describe("roads overlay", () => {
  it("is registered as a keyless context overlay", () => {
    const plugin = getLayerPlugin("roads");
    assert.ok(plugin, "roads must be a registered layer");
    assert.equal(plugin!.kind, "raster");
    assert.equal(plugin!.manifest.category, "transport");
  });

  it("offers the OpenMapTiles transportation classes as filters", () => {
    const manifest = getLayerManifestV2("roads");
    const facet = manifest?.filters?.find((entry) => entry.id === "class");
    assert.ok(facet, "the class filter must exist");
    const optionIds = facet!.options?.map((option) => option.id) ?? [];
    for (const id of ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"]) {
      assert.ok(optionIds.includes(id), `class ${id} must be selectable`);
    }
  });
});
