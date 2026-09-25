/**
 * Keeping a drafted layer (§30.7).
 *
 * A layer the assistant handed over lives for the session. Saving it turns it into an ordinary
 * personal layer — one `POST /user-layers` and one pin per point — with the provenance written
 * onto every pin, so a place saved from an answer never looks like a place someone surveyed.
 */

import type { LayerManifestV2 } from "@mapos/layer-sdk";
import { apiPost } from "../lib/api";
import { emit } from "../lib/events";

export interface SavedInlineLayer {
  layerId: string;
  saved: number;
  /** Points the server refused; the caller says so rather than claiming a complete layer. */
  failed: number;
}

export async function saveInlineLayerAsUserLayer(
  manifest: LayerManifestV2
): Promise<SavedInlineLayer> {
  const inline = manifest.source.inline;
  if (!inline?.features.length) throw new Error("Vrstva neobsahuje žádná místa");

  const created = await apiPost<{ layer: { id: string } }>(
    "/user-layers",
    { name: manifest.name.slice(0, 120), color: manifest.color },
    { auth: true }
  );
  const layerId = created.layer.id;
  const provenance = inline.provenance;

  let saved = 0;
  let failed = 0;
  for (const feature of inline.features) {
    try {
      await apiPost(
        `/user-layers/${layerId}/pins`,
        {
          name: feature.title,
          lng: feature.longitude,
          lat: feature.latitude,
          ...(feature.summary ? { description: feature.summary } : {}),
          kind: "place",
          properties: {
            sourceId: feature.sourceId,
            ...(feature.category ? { category: feature.category } : {}),
            ...(feature.url ? { url: feature.url } : {}),
            ...(provenance ? { provenance } : {})
          }
        },
        { auth: true }
      );
      saved += 1;
    } catch {
      failed += 1;
    }
  }
  emit("layers-changed");
  return { layerId, saved, failed };
}
