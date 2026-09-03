/**
 * A layer the assistant can hand over (§30.7).
 *
 * `emit_layer` does not let a model describe a data source; it lets it choose, from places a tool
 * already returned, which ones belong together — and the server turns that choice into a normal
 * `LayerManifestV2` with an inline source. Two consequences are the point of doing it this way:
 * the points are the same rows the answer cited, and the manifest is validated by the same
 * validator every other layer goes through, so a malformed proposal never reaches the map.
 */

import {
  MAPOS_LAYER_SDK_RANGE,
  assertLayerManifestV2,
  type InlineFeatureV2,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import type { AiCitation } from "./contracts.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

const MAX_INLINE_FEATURES = 200;

/** Layer ids are joined into style ids, css class names and session keys; a name is not. */
export function inlineLayerId(name: string, seed: string): string {
  const slug = name
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  return `ai-${slug || "vrstva"}-${seed}`.slice(0, 64);
}

export interface InlineLayerInput {
  name: string;
  description?: string;
  places: readonly AiPlaceSearchRecord[];
  sources: readonly AiCitation[];
  generatedAt: string;
  seed: string;
  /** The question and the model behind the layer; absent on the deterministic path, which had
   *  no model and therefore records the act as `manual`. */
  prompt?: string;
  model?: string;
}

/**
 * Builds and validates the manifest. Throws when the result would not be a valid layer, which is
 * the caller's signal to answer without a layer card rather than to ship a broken one.
 */
export function buildInlineLayerManifest(input: InlineLayerInput): LayerManifestV2 {
  const features: InlineFeatureV2[] = [];
  const seen = new Set<string>();
  for (const place of input.places) {
    if (features.length >= MAX_INLINE_FEATURES || seen.has(place.id)) continue;
    seen.add(place.id);
    features.push({
      id: place.id,
      title: place.title.slice(0, 240),
      longitude: place.longitude,
      latitude: place.latitude,
      ...(place.category ? { category: place.category.slice(0, 120) } : {}),
      sourceId: place.sourceId
    });
  }
  if (!features.length) throw new Error("an inline layer needs at least one sourced place");

  const cited = new Set(features.map((feature) => feature.sourceId));
  const attribution = input.sources
    .filter((source) => cited.has(source.sourceId))
    .slice(0, 20)
    .map((source) => ({
      label: source.label.slice(0, 240),
      ...(source.url ? { url: source.url } : {}),
      requiredOnMap: true,
      requiredOnExport: true
    }));
  if (!attribution.length)
    throw new Error("an inline layer must carry the attribution of its data");

  const name = input.name.trim().slice(0, 120) || "Vrstva z AI";
  const manifest: LayerManifestV2 = {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    id: inlineLayerId(name, input.seed),
    name: `AI: ${name}`.slice(0, 120),
    description: (
      input.description?.trim() ||
      `Návrh vrstvy z odpovědi asistenta: ${features.length} míst ze zdrojů, které odpověď citovala.`
    ).slice(0, 600),
    icon: "auto_awesome",
    color: "#7C4DFF",
    category: "user",
    modes: ["discover", "planning"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", style: { iconByCategory: true }, zIndex: 620 },
    source: {
      type: "inline",
      inline: {
        generatedAt: input.generatedAt,
        // Provenance travels with the layer because there is no endpoint to ask later (§30.7).
        provenance: {
          kind: input.model ? "ai" : "manual",
          ...(input.model ? { model: input.model.slice(0, 120) } : {}),
          ...(input.prompt?.trim() ? { prompt: input.prompt.trim().slice(0, 2_000) } : {}),
          createdAt: input.generatedAt,
          sourceIds: [...cited].slice(0, 50)
        },
        features
      }
    },
    queryPolicy: { strategy: "manual" },
    attribution,
    // No query, no filters, no detail tabs: everything this layer will ever know is already here.
    capabilities: ["query", "export"]
  };
  assertLayerManifestV2(manifest);
  return manifest;
}

export function inlineLayerFeatureCount(manifest: LayerManifestV2): number {
  return manifest.source.inline?.features.length ?? 0;
}
