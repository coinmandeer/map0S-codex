/**
 * Layers whose data travels with the manifest (§30.7).
 *
 * The assistant hands over a `LayerManifestV2` with an `inline` source: the points are already in
 * it, so there is nothing to fetch and nothing to keep in sync. Registering one is therefore a
 * browser-only act — the layer lives for this session, appears in the mega-menu like any other,
 * and disappears on reload unless the user saves it as their own layer.
 */

import type { FeatureCollection, LayerManifestV2 } from "@mapos/layer-sdk";
import { createPinsLayerHandle } from "./pinsLayer";
import { getLayerManifestV2, registerLayerV2 } from "./registry";

export function inlineFeatureCollection(manifest: LayerManifestV2): FeatureCollection {
  const features = manifest.source.inline?.features ?? [];
  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [feature.longitude, feature.latitude] },
      properties: {
        id: feature.id,
        layerId: manifest.id,
        name: feature.title,
        ...(feature.category ? { category: feature.category } : {}),
        ...(feature.summary ? { summary: feature.summary } : {}),
        ...(feature.url ? { url: feature.url } : {})
      }
    }))
  };
}

/**
 * Makes the layer known to the registry and returns its id.
 *
 * Re-registering the same id is a no-op: the manifest is immutable, so a second call from a
 * re-rendered card must not replace a layer the user already has switched on.
 */
export function registerInlineLayer(manifest: LayerManifestV2): string {
  if (getLayerManifestV2(manifest.id)) return manifest.id;
  const data = inlineFeatureCollection(manifest);
  registerLayerV2({
    manifest,
    viewportCost: "cheap",
    create: (ctx) =>
      createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color, async () => data)
  });
  return manifest.id;
}
