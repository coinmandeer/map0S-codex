import type { LayerAttribution } from "@mapos/layer-sdk";
import { PLACE_SOURCES } from "@mapos/layer-sdk";
import { allLayerPlugins, getLayerPlugin } from "./registry";

/**
 * Who to credit, derived rather than written down.
 *
 * Attribution used to be a sentence in the About section listing whatever was true when it was
 * written. Every source is already declared next to the layer or place source that uses it, so
 * the credit line is computed from what is actually switched on — which is also what most of
 * these licences require: credit when the data is shown, not in general.
 */

/** Basemap credits. The map control picks these up from the style's own `attribution` fields, so
 *  they are repeated here only for the About list, which is read with the map switched off. */
const BASE_ATTRIBUTION: LayerAttribution[] = [
  {
    label: "© OpenStreetMap přispěvatelé",
    url: "https://www.openstreetmap.org/copyright",
    license: "ODbL-1.0"
  },
  { label: "© CARTO", url: "https://carto.com/attributions" },
  { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API ToS" }
];

function dedupe(entries: LayerAttribution[]): LayerAttribution[] {
  const byLabel = new Map<string, LayerAttribution>();
  for (const entry of entries) {
    // First mention wins, so a layer that names a licence isn't overwritten by one that doesn't.
    if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry);
  }
  return [...byLabel.values()];
}

/** Credits for what is on screen right now, minus the basemap: those ride along with the style
 *  and the map control already shows them. */
export function activeAttribution(
  activeLayers: Record<string, { visible: boolean }>,
  poiSources: Record<string, boolean> = {}
): LayerAttribution[] {
  const fromLayers = Object.entries(activeLayers).flatMap(([layerId, state]) =>
    state.visible ? (getLayerPlugin(layerId)?.attribution ?? []) : []
  );

  const fromSources = PLACE_SOURCES.flatMap((source) =>
    poiSources[source.id] && source.attribution
      ? [{ label: source.attribution, url: source.url, license: source.license }]
      : []
  );

  return dedupe([...fromLayers, ...fromSources]);
}

export interface AttributionEntry extends LayerAttribution {
  /** What uses it, so the About list reads as "this layer, from this source" rather than as an
   *  undifferentiated wall of names. */
  usedBy: string;
}

/** Every source the build can call, whether or not it is on — the About section's list. */
export function allAttribution(): AttributionEntry[] {
  const entries: AttributionEntry[] = BASE_ATTRIBUTION.map((a) => ({
    ...a,
    usedBy: "Podkladová mapa"
  }));

  for (const plugin of allLayerPlugins()) {
    for (const attribution of plugin.attribution ?? []) {
      entries.push({ ...attribution, usedBy: plugin.manifest.name });
    }
  }

  for (const source of PLACE_SOURCES) {
    if (source.attribution) {
      entries.push({
        label: source.attribution,
        url: source.url,
        license: source.license,
        usedBy: source.label
      });
    }
  }

  return entries.sort((a, b) => a.usedBy.localeCompare(b.usedBy, "cs"));
}
