import assert from "node:assert/strict";
import test from "node:test";
import { MAPOS_LAYER_SDK_RANGE, type LayerManifestV2 } from "@mapos/layer-sdk";
import { inlineFeatureCollection, registerInlineLayer } from "./inlineLayers";
import { getLayerManifestV2, layerCatalog, resetLayerRegistry } from "./registry";

function manifest(id = "ai-vyhlidky-abc"): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    id,
    name: "AI: Vyhlídky",
    description: "Návrh vrstvy z odpovědi asistenta.",
    icon: "auto_awesome",
    color: "#7C4DFF",
    category: "user",
    modes: ["discover"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", style: { iconByCategory: true }, zIndex: 620 },
    source: {
      type: "inline",
      inline: {
        generatedAt: "2026-09-02T10:00:00.000Z",
        features: [
          {
            id: "osm:1",
            title: "Petřín",
            longitude: 14.395,
            latitude: 50.083,
            category: "viewpoint",
            sourceId: "osm"
          }
        ]
      }
    },
    queryPolicy: { strategy: "manual" },
    attribution: [{ label: "OpenStreetMap", requiredOnMap: true, requiredOnExport: true }],
    capabilities: ["query", "export"]
  };
}

test("an inline manifest becomes a session layer whose points need no request", (t) => {
  t.after(() => resetLayerRegistry());
  const layerId = registerInlineLayer(manifest());

  assert.equal(getLayerManifestV2(layerId)?.source.type, "inline");
  assert.ok(
    layerCatalog(null).some((entry) => entry.manifest.id === layerId),
    "the drafted layer is listed like any other"
  );
  const data = inlineFeatureCollection(manifest());
  assert.equal(data.features.length, 1);
  assert.deepEqual(data.features[0]!.properties, {
    id: "osm:1",
    layerId: "ai-vyhlidky-abc",
    name: "Petřín",
    category: "viewpoint"
  });
});

test("registering the same drafted layer twice keeps the one the user already switched on", (t) => {
  t.after(() => resetLayerRegistry());
  registerInlineLayer(manifest());
  const second = { ...manifest(), name: "AI: Něco jiného" };
  registerInlineLayer(second);
  assert.equal(getLayerManifestV2("ai-vyhlidky-abc")?.name, "AI: Vyhlídky");
});
