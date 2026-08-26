import type maplibregl from "maplibre-gl";
import type {
  LayerCatalogEntry,
  LayerHandle,
  LayerMode,
  LayerPlugin,
  ServerCapabilities
} from "@mapos/layer-sdk";

/**
 * The web-side plugin shape.
 *
 * `LayerPlugin` in the SDK covers data and lifecycle only, because the API imports that package
 * too. Anything React-facing is added here, where depending on the UI is fine.
 */
export interface MapLayerPlugin extends LayerPlugin<maplibregl.Map> {
  /** Ids of info panels this layer contributes to the place detail sheet. Resolved against the
   *  info-panel registry so a layer can add a tab without the sheet importing it. */
  infoPanelIds?: string[];
}

const plugins = new Map<string, MapLayerPlugin>();

/** Registration is a plain function rather than a static array so a plugin can live next to the
 *  code it renders, and a fork can add one without editing a central list. */
export function registerLayer(plugin: MapLayerPlugin): void {
  if (plugins.has(plugin.manifest.id)) {
    throw new Error(
      `Layer "${plugin.manifest.id}" is already registered. Layer ids must be unique — ` +
        `they key the map sources, the URL state and the feature cache.`
    );
  }
  plugins.set(plugin.manifest.id, plugin);
}

export function getLayerPlugin(id: string): MapLayerPlugin | undefined {
  return plugins.get(id);
}

export function allLayerPlugins(): MapLayerPlugin[] {
  return [...plugins.values()];
}

/** Layers the server can actually serve. A layer gated behind a key the deployment doesn't hold
 *  is hidden rather than shown broken. */
export function availableLayerPlugins(caps: ServerCapabilities | null): MapLayerPlugin[] {
  return allLayerPlugins().filter((p) => {
    const need = p.manifest.requiresCapability;
    if (!need) return true;
    return Boolean(caps?.[need as keyof ServerCapabilities]);
  });
}

export function layerCatalog(caps: ServerCapabilities | null = null): LayerCatalogEntry[] {
  return availableLayerPlugins(caps).map((p) => ({
    manifest: p.manifest,
    filters: p.filters,
    kind: p.kind
  }));
}

/** The layer a mode switches on. Derived from the manifests, so moving a layer between sections
 *  is a one-line manifest edit instead of an edit to a table the store owns. */
export function primaryLayerForMode(mode: LayerMode): string {
  const match = allLayerPlugins().find((p) => p.manifest.primaryForModes?.includes(mode));
  if (!match) {
    throw new Error(`No layer claims to be primary for mode "${mode}".`);
  }
  return match.manifest.id;
}

export function layerIdsForMode(mode: LayerMode): string[] {
  return allLayerPlugins()
    .filter((p) => p.manifest.modes?.includes(mode))
    .map((p) => p.manifest.id);
}

/** Layers not tied to any section — the "extras" list in the mega-menu. */
export function extraLayerPlugins(caps: ServerCapabilities | null = null): MapLayerPlugin[] {
  return availableLayerPlugins(caps).filter((p) => !p.manifest.modes?.length);
}

export function createLayerHandle(
  plugin: MapLayerPlugin,
  map: maplibregl.Map,
  apiBaseUrl: string
): LayerHandle {
  return plugin.create({
    map,
    apiBaseUrl,
    layerId: plugin.manifest.id,
    color: plugin.manifest.color
  });
}

/** Test seam: the registry is module-level state, so specs need a way back to empty. */
export function resetLayerRegistry(): void {
  plugins.clear();
}
