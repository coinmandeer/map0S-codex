import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLayerManifestV2, getLayerPlugin } from "../registry";
import "./overtureLayers";

/**
 * Overture ships as a bounded self-hosted extract, not the global public tiles. The global tiles
 * are built for data inspection (one z14 Prague tile is ~8.5 MB), so pointing a live layer at them
 * would stall the map. These tests pin the two things that keep that decision honest: the layer is
 * capability-gated so it is absent until an extract exists, and it reads our own origin rather than
 * Overture's.
 */
describe("Overture layers", () => {
  it("registers places and buildings as capability-gated overlays", () => {
    for (const id of ["overture-places", "overture-buildings"]) {
      const plugin = getLayerPlugin(id);
      assert.ok(plugin, `${id} must be registered`);
      const manifest = getLayerManifestV2(id);
      assert.equal(manifest?.compatibility?.legacyLayerId ?? id, id, `${id} keeps its id`);
      // The gate is what makes this safe to ship without an import present.
      const gated = getLayerPlugin(id)?.manifest as { requiresCapability?: string } | undefined;
      assert.equal(gated?.requiresCapability, "overture", `${id} must be gated on the import`);
    }
  });

  it("never points a live layer at Overture's public tile host", () => {
    const source = JSON.stringify(getLayerManifestV2("overture-places")?.source ?? {});
    assert.doesNotMatch(
      source,
      /overturemaps-extras-us-west-2|amazonaws\.com/,
      "the layer must read the self-hosted extract, not the global archives"
    );
  });
});
