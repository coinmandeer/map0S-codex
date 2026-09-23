import { CATALOG_GROUPS } from "./layers/catalogModel";
import type { FilterValues } from "@mapos/layer-sdk";
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

const THEMATIC_CATEGORIES = new Set([
  "weather",
  "events",
  "environment",
  "routing",
  "game",
  "statistics"
]);

/**
 * Badge rule: an available, visible, user-toggleable layer counts once. Structural map surfaces
 * are omitted because Tiles owns them. Point-like place/community layers are POI; environmental,
 * temporal, routing and game contexts (plus every non-pin renderer) are thematic.
 */
export function activeLayerSummary(
  activeLayers: Record<string, { visible?: boolean; filters?: FilterValues }>,
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
    const filters = activeLayers[layer.id]?.filters;
    const rows = CATALOG_GROUPS.flatMap((g) => g.items).filter((i) => i.layer === layer.id);
    const count =
      filters && rows.some((i) => i.facet)
        ? rows.filter(
            (i) =>
              !i.facet ||
              i.values?.some((v) =>
                (Array.isArray(filters[i.facet!])
                  ? (filters[i.facet!] as unknown[])
                  : [filters[i.facet!]]
                ).includes(v)
              )
          ).length
        : 1;
    if (layer.kind === "pins" && !THEMATIC_CATEGORIES.has(layer.category)) poi += count;
    else thematic += count;
  }
  return { poi, thematic, total: poi + thematic };
}

/** Two letters for the phone rail (§3.2), where the button is a 44 px square and the full name
 *  has nowhere to go: initials of the first two words, or the first two letters of a single one. */
export function basemapInitials(label: string): string {
  const words = label
    .trim()
    .split(/[\s·/–-]+/u)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return "??";
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toLocaleUpperCase("cs");
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!)
    .join("")
    .toLocaleUpperCase("cs");
}

export function compactBasemapLabel(label: string, maxCharacters = 14): string {
  const normalized = label.trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  if (maxCharacters <= 1) return "…";
  return `${characters
    .slice(0, maxCharacters - 1)
    .join("")
    .trimEnd()}…`;
}
