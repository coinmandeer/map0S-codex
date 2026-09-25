import { VANLIFE_CATEGORIES, type FilterValues } from "@mapos/layer-sdk";

/**
 * Layers that were retired because another layer already draws exactly the same data.
 *
 * `vanlife` was a second OSM query for the camping categories that `osm-poi` already offers one
 * by one (camp site, caravan site, dump station, drinking water…). With both on — which the
 * built-in travel preset did — every campsite was fetched twice and drawn as two stacked pins.
 *
 * Old URLs, saved sessions, saved presets and share links still carry the retired id. Instead of
 * silently dropping it, its facet values are folded into the canonical layer, so the reader sees
 * the same places as before, once.
 */
export interface RetiredLayerAlias {
  layer: string;
  facet: string;
  /** Values the retired layer drew when its own filter was never touched. */
  defaults: readonly string[];
}

export const RETIRED_LAYER_ALIASES: Readonly<Record<string, RetiredLayerAlias>> = {
  vanlife: { layer: "osm-poi", facet: "categories", defaults: VANLIFE_CATEGORIES }
};

export function retiredLayerAlias(layerId: string): RetiredLayerAlias | undefined {
  return Object.prototype.hasOwnProperty.call(RETIRED_LAYER_ALIASES, layerId)
    ? RETIRED_LAYER_ALIASES[layerId]
    : undefined;
}

type LayerEntry = { visible: boolean; selected?: boolean; opacity: number; filters: FilterValues };

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];

/** Facet values a retired entry contributes to its canonical layer. */
export function retiredFacetValues(entry: LayerEntry | undefined, alias: RetiredLayerAlias) {
  const own = list(entry?.filters?.[alias.facet]);
  return own.length ? own : [...alias.defaults];
}

/**
 * Replaces retired layer ids with their canonical layer, merging facet values and keeping the
 * canonical entry's position (or the retired one's, when the canonical layer was not there).
 * Returns the same object when nothing needed folding.
 */
export function foldRetiredLayers<T extends LayerEntry>(
  layers: Record<string, T>,
  initial: (layerId: string) => T
): Record<string, T> {
  if (!Object.keys(layers).some((id) => retiredLayerAlias(id))) return layers;
  const out: Record<string, T> = {};
  for (const [id, entry] of Object.entries(layers)) {
    const alias = retiredLayerAlias(id);
    if (!alias) {
      if (!out[id]) out[id] = entry;
      continue;
    }
    const target = out[alias.layer] ?? layers[alias.layer] ?? initial(alias.layer);
    const current = list(target.filters?.[alias.facet]);
    const selectedKey = `_selected_${alias.facet}`;
    const contributed = entry.visible ? retiredFacetValues(entry, alias) : [];
    const merged = entry.visible
      ? [...new Set([...(layers[alias.layer]?.visible ? current : []), ...contributed])]
      : current;
    out[alias.layer] = {
      ...target,
      visible: Boolean(layers[alias.layer]?.visible || entry.visible),
      selected: target.selected !== false || entry.selected !== false,
      filters: {
        ...target.filters,
        [alias.facet]: merged,
        ...(target.filters?.[selectedKey] !== undefined || entry.visible
          ? {
              [selectedKey]: [
                ...new Set([...list(target.filters?.[selectedKey] ?? current), ...contributed])
              ]
            }
          : {})
      }
    };
  }
  return out;
}
