export interface LayerActivityDescriptor {
  id: string;
  kind: string;
  category: string;
  experienceIds?: readonly string[];
}

export interface LayerActivitySummary {
  poi: number;
  thematic: number;
  total: number;
}

const THEMATIC_CATEGORIES = new Set(["weather", "events", "environment", "routing", "game"]);

/**
 * Badge rule: an available, visible, user-toggleable layer counts once. Structural map surfaces
 * are omitted because Tiles owns them. Point-like place/community layers are POI; environmental,
 * temporal, routing and game contexts (plus every non-pin renderer) are thematic.
 */
export function activeLayerSummary(
  activeLayers: Record<string, { visible?: boolean }>,
  availableLayers: readonly LayerActivityDescriptor[],
  experienceId: string,
  isStructural: (layerId: string) => boolean
): LayerActivitySummary {
  let poi = 0;
  let thematic = 0;
  const seen = new Set<string>();
  for (const layer of availableLayers) {
    if (seen.has(layer.id) || !activeLayers[layer.id]?.visible || isStructural(layer.id)) continue;
    if (layer.experienceIds?.length && !layer.experienceIds.includes(experienceId)) continue;
    seen.add(layer.id);
    if (layer.kind === "pins" && !THEMATIC_CATEGORIES.has(layer.category)) poi += 1;
    else thematic += 1;
  }
  return { poi, thematic, total: poi + thematic };
}

export function compactBasemapLabel(label: string, maxCharacters = 18): string {
  const normalized = label.trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  if (maxCharacters <= 1) return "…";
  return `${characters
    .slice(0, maxCharacters - 1)
    .join("")
    .trimEnd()}…`;
}
