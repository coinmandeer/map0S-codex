import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LayerManifestV2 } from "@mapos/layer-sdk";
import { LayerRuntimeRegistry, negotiateLayerCapabilities } from "./registry.js";

const manifest = {
  schema: "mapos.layer-manifest",
  schemaVersion: "2.0.0",
  sdkRange: "^2.0.0",
  id: "clean-room.places",
  name: "Clean-room places",
  description: "Static fixture",
  category: "community",
  geometryKinds: ["Point"],
  renderer: { type: "circles" },
  source: { type: "static" },
  queryPolicy: { strategy: "viewport", maxResultsPerViewport: 20 },
  attribution: [{ label: "Fixture", license: "CC0-1.0" }],
  capabilities: ["query", "detail", "export"],
  requiresServerCapabilities: ["catalogue"]
} satisfies LayerManifestV2;

describe("LayerRuntimeRegistry", () => {
  it("validates manifests and rejects duplicate or incompatible registrations", () => {
    const registry = new LayerRuntimeRegistry<{ fixture: boolean }>();
    registry.register({ manifest, value: { fixture: true } });
    assert.equal(registry.get(manifest.id)?.value.fixture, true);
    assert.throws(() => registry.register({ manifest, value: { fixture: false } }), /already/);
    assert.throws(
      () =>
        registry.register({
          manifest: { ...manifest, id: "future", sdkRange: "^3.0.0" },
          value: { fixture: false }
        }),
      /UNSUPPORTED_SDK_RANGE/
    );
  });

  it("negotiates deployment, renderer, source and optional layer capabilities", () => {
    const blocked = negotiateLayerCapabilities(manifest, {
      server: { catalogue: false },
      renderers: ["circles"],
      sources: ["static"],
      layer: ["query", "detail"]
    });
    assert.equal(blocked.enabled, false);
    assert.deepEqual(blocked.missingServerCapabilities, ["catalogue"]);
    assert.deepEqual(blocked.negotiatedLayerCapabilities, ["query", "detail"]);
    assert.deepEqual(blocked.unavailableLayerCapabilities, ["export"]);

    const enabled = negotiateLayerCapabilities(manifest, {
      server: { catalogue: "fixture" },
      renderers: ["circles"],
      sources: ["static"]
    });
    assert.equal(enabled.enabled, true);
  });
});
