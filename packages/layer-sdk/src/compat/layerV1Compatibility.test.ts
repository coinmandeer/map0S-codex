import assert from "node:assert/strict";
import { describe, it } from "node:test";
import legacyFixture from "./fixtures/osm-poi-layer-v1.json" with { type: "json" };
import type { LayerManifest } from "../types.js";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  validateLayerManifestV2
} from "../v2/index.js";
import { layerV1ToV2, layerV2ToV1, type LayerV1AdapterOptions } from "./index.js";

describe("declared v1 layer compatibility window", () => {
  it("adapts the checked-in production-shaped OSM layer fixture into the v2 contract", () => {
    const adapted = layerV1ToV2(
      legacyFixture.manifest as LayerManifest,
      legacyFixture.options as LayerV1AdapterOptions
    );
    const validation = validateLayerManifestV2(adapted, { availableCapabilities: [] });
    assert.equal(validation.valid, true, JSON.stringify(validation));
    const mapos20Validation = validateLayerManifestV2(adapted, {
      runtimeVersion: "20.0.0",
      availableCapabilities: []
    });
    assert.equal(mapos20Validation.valid, true, JSON.stringify(mapos20Validation));
    assert.equal(adapted.sdkRange, MAPOS_LAYER_SDK_RANGE);
    assert.equal(adapted.minimumRuntime, MAPOS_HOST_RUNTIME_VERSION);
    assert.equal(adapted.compatibility?.legacyLayerId, "osm-poi");
    assert.equal(adapted.compatibility?.legacyAdapter, "layerV1ToV2");
    assert.deepEqual(adapted.modes, ["planning", "discover"]);
    assert.deepEqual(adapted.capabilities, ["query", "filter"]);
    assert.equal(adapted.attribution?.[0]?.license, "ODbL-1.0");
  });

  it("keeps user-visible v1 fields stable after the deterministic v1→v2→v1 adapter path", () => {
    const adapted = layerV1ToV2(
      legacyFixture.manifest as LayerManifest,
      legacyFixture.options as LayerV1AdapterOptions
    );
    const legacyView = layerV2ToV1(adapted);
    assert.deepEqual(
      {
        id: legacyView.manifest.id,
        name: legacyView.manifest.name,
        description: legacyView.manifest.description,
        icon: legacyView.manifest.icon,
        color: legacyView.manifest.color,
        category: legacyView.manifest.category,
        modes: legacyView.manifest.modes
      },
      {
        id: legacyFixture.manifest.id,
        name: legacyFixture.manifest.name,
        description: legacyFixture.manifest.description,
        icon: legacyFixture.manifest.icon,
        color: legacyFixture.manifest.color,
        category: legacyFixture.manifest.category,
        modes: legacyFixture.manifest.modes
      }
    );
    assert.deepEqual(legacyView.filters, legacyFixture.options.filters);
    assert.deepEqual(legacyView.attribution, legacyFixture.options.attribution);
  });
});
