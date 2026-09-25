import type { LayerAttribution } from "@mapos/layer-sdk";
import { BASEMAPS, LABEL_OVERLAYS, RELEASED_PLACE_SOURCES } from "@mapos/layer-sdk";
import { allLayerPlugins, getLayerPlugin } from "./registry";
import { intlLocale } from "../i18n";

/**
 * Who to credit, derived rather than written down.
 *
 * Attribution used to be a sentence in the About section listing whatever was true when it was
 * written. Every source is already declared next to the layer or place source that uses it, so
 * the credit line is computed from what is actually switched on — which is also what most of
 * these licences require: credit when the data is shown, not in general.
 */

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

  const fromSources = RELEASED_PLACE_SOURCES.flatMap((source) =>
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
  // Backgrounds come from the catalogue rather than from a hand-kept list, so a basemap added
  // to the SDK shows up here without anybody remembering to credit it.
  const entries: AttributionEntry[] = BASEMAPS.flatMap((basemap) =>
    basemap.attribution.map((a) => ({ ...a, usedBy: `Podklad: ${basemap.label}` }))
  );
  for (const overlay of LABEL_OVERLAYS) {
    for (const attribution of overlay.attribution) {
      entries.push({ ...attribution, usedBy: `Popisky: ${overlay.label}` });
    }
  }

  for (const plugin of allLayerPlugins()) {
    for (const attribution of plugin.attribution ?? []) {
      entries.push({ ...attribution, usedBy: plugin.manifest.name });
    }
  }

  for (const source of RELEASED_PLACE_SOURCES) {
    if (source.attribution) {
      entries.push({
        label: source.attribution,
        url: source.url,
        license: source.license,
        usedBy: source.label
      });
    }
  }

  return entries.sort((a, b) => a.usedBy.localeCompare(b.usedBy, intlLocale()));
}
