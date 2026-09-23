import assert from "node:assert/strict";
import test from "node:test";
import { assertLayerManifestV2 } from "@mapos/layer-sdk";
import { buildInlineLayerManifest, inlineLayerFeatureCount } from "./inlineLayer.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

function place(id: string, sourceId = "osm"): AiPlaceSearchRecord {
  return {
    id,
    layerId: "osm-poi",
    title: `Místo ${id}`,
    category: "viewpoint",
    longitude: 14.4,
    latitude: 50.08,
    sourceId
  };
}

test("a layer the assistant emits carries only cited places and passes the normal validator", () => {
  const manifest = buildInlineLayerManifest({
    name: "Vyhlídky nad Vltavou",
    places: [place("a"), place("b"), place("a")],
    sources: [
      { sourceId: "osm", label: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
      { sourceId: "unused", label: "Zdroj, který nic nedodal" }
    ],
    generatedAt: "2026-09-02T10:00:00.000Z",
    seed: "abc123"
  });

  assertLayerManifestV2(manifest);
  assert.equal(inlineLayerFeatureCount(manifest), 2);
  assert.equal(manifest.source.type, "inline");
  assert.match(manifest.id, /^ai-vyhlidky-nad-vltavou-abc123$/);
  // Only the source the features actually came from is attributed; the rest is not the layer's.
  assert.deepEqual(
    (manifest.attribution ?? []).map((entry) => entry.label),
    ["OpenStreetMap"]
  );
});

test("an unattributable or empty selection is refused rather than shipped as a layer", () => {
  assert.throws(() =>
    buildInlineLayerManifest({
      name: "Prázdno",
      places: [],
      sources: [{ sourceId: "osm", label: "OpenStreetMap" }],
      generatedAt: "2026-09-02T10:00:00.000Z",
      seed: "abc123"
    })
  );
  assert.throws(() =>
    buildInlineLayerManifest({
      name: "Bez zdroje",
      places: [place("a", "mystery")],
      sources: [{ sourceId: "osm", label: "OpenStreetMap" }],
      generatedAt: "2026-09-02T10:00:00.000Z",
      seed: "abc123"
    })
  );
});

test("draft keeps original resolver references and limits map results to100", () => {
  const manifest = buildInlineLayerManifest({
    name: "Results",
    places: Array.from({ length: 120 }, (_, i) => place(String(i))),
    sources: [{ sourceId: "osm", label: "OSM" }],
    generatedAt: "2026-09-08T00:00:00Z",
    seed: "test"
  });
  assert.equal(manifest.source.inline!.features.length, 100);
  assert.equal(manifest.source.inline!.features[0]!.sourceLayerId, "osm-poi");
  assert.equal(manifest.source.inline!.features[0]!.sourceFeatureId, "0");
});
