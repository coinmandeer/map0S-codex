import type maplibregl from "maplibre-gl";
import type {
  FilterValues,
  LayerCatalogEntry,
  LayerHandle,
  LayerManifestV2,
  LayerMode,
  LayerPlugin,
  ServerCapabilities
} from "@mapos/layer-sdk";
import { assertLayerManifestV2, layerV1ToV2, layerV2ToV1 } from "@mapos/layer-sdk";
import { LayerRuntimeRegistry } from "@mapos/map-runtime";
import { legacyLayerModeFor, type AppMode } from "../product/registry";

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
  /** What the colours on the map mean. Legends reach the footer through the v2 manifest, and a
   *  v1 raster overlay has no way to declare one otherwise — a map of coloured lines with no
   *  key is decoration. */
  legend?: LayerManifestV2["legend"];
  /** Which provider fields the detail sheet shows, and in what order. Same reason as `legend`:
   *  the sheet reads this off the v2 manifest, so without it a v1 layer's own fields never
   *  appear however carefully the server sent them. */
  detail?: LayerManifestV2["detail"];
  /** Capabilities the v1 shape cannot prove on its own — `media` for a layer whose features
   *  carry photos, so the detail sheet offers a Photos tab instead of hiding one. */
  capabilities?: LayerManifestV2["capabilities"];
  minQueryZoom?: number;
  geometryKinds?: LayerManifestV2["geometryKinds"];
  renderer?: LayerManifestV2["renderer"];
  areaFilter?: "geometry" | "context";
}

/** V2 owns discovery/query metadata while the existing lifecycle keeps rendering unchanged. */
export interface MapLayerPluginV2 extends Omit<
  MapLayerPlugin,
  "manifest" | "filters" | "attribution" | "kind"
> {
  manifest: LayerManifestV2;
  /** The V1 shell still asks for one primary layer per mode. This bridge is removed once the
   *  shell consumes the V2 experience manifest directly. */
  primaryForModes?: LayerMode[];
}

const runtimeRegistry = new LayerRuntimeRegistry<MapLayerPlugin>();

function storePlugin(plugin: MapLayerPlugin, manifestV2: LayerManifestV2): void {
  if (plugin.areaFilter)
    manifestV2 = {
      ...manifestV2,
      queryPolicy: { ...manifestV2.queryPolicy, areaFilter: plugin.areaFilter }
    };
  manifestV2 = {
    ...manifestV2,
    ...(plugin.geometryKinds ? { geometryKinds: plugin.geometryKinds } : {}),
    ...(plugin.renderer ? { renderer: plugin.renderer } : {})
  };
  runtimeRegistry.register({ manifest: manifestV2, value: plugin });
}

/** Registration is a plain function rather than a static array so a plugin can live next to the
 *  code it renders, and a fork can add one without editing a central list. */
export function registerLayer(plugin: MapLayerPlugin): void {
  storePlugin(
    plugin,
    layerV1ToV2(plugin.manifest, {
      kind: plugin.kind,
      filters: plugin.filters,
      ...(plugin.capabilities ? { capabilities: plugin.capabilities } : {}),
      attribution: plugin.attribution,
      viewportCost: plugin.viewportCost,
      legend: plugin.legend,
      detail: plugin.detail
    })
  );
}

/** Registers a canonical v2 manifest and adapts it into the current visual host. */
export function registerLayerV2(
  plugin: MapLayerPluginV2,
  options: { replace?: boolean } = {}
): void {
  assertLayerManifestV2(plugin.manifest);
  const legacy = layerV2ToV1(plugin.manifest);
  const { primaryForModes, ...runtime } = plugin;
  // Validate and adapt before replacing, so a malformed update preserves the working layer.
  if (options.replace) runtimeRegistry.unregister(plugin.manifest.id);
  storePlugin(
    {
      ...runtime,
      kind: legacy.kind,
      manifest: {
        ...legacy.manifest,
        ...(primaryForModes?.length ? { primaryForModes } : {})
      },
      filters: legacy.filters,
      attribution: legacy.attribution
    },
    plugin.manifest
  );
}

/** Drops a layer registered after startup — one built from a pasted URL, when the user deletes
 *  it. Built-in layers are never unregistered, and passing one of their ids is a caller bug
 *  rather than something to tolerate silently. */
export function unregisterLayer(id: string): boolean {
  return runtimeRegistry.unregister(id);
}

export function getLayerPlugin(id: string): MapLayerPlugin | undefined {
  return runtimeRegistry.get(id)?.value;
}

export function allLayerPlugins(): MapLayerPlugin[] {
  return runtimeRegistry.all().map(({ value }) => value);
}

export function getLayerManifestV2(id: string): LayerManifestV2 | undefined {
  return runtimeRegistry.get(id)?.manifest;
}

/** One availability decision shared by the catalog and engine. */
export function layerUnavailableReason(
  id: string,
  caps: ServerCapabilities | null,
  filters?: FilterValues
): string | undefined {
  const plugin = getLayerPlugin(id);
  if (!plugin) return "Zdroj zatím není dostupný";
  const sources = Array.isArray(filters?.sources)
    ? filters.sources
    : filters?.sources
      ? [filters.sources]
      : [];
  if (
    id === "game-quests" &&
    sources.length &&
    sources.every((source) => source === "opencaching") &&
    !caps?.opencaching
  )
    return "Geocaching není nakonfigurovaný (OKAPI klíč)";
  const required = (
    getLayerManifestV2(id)?.requiresServerCapabilities ??
    (plugin.manifest.requiresCapability ? [plugin.manifest.requiresCapability] : [])
  ).find((key) => !caps?.[key]);
  if (required)
    return caps === null
      ? "Ověřuji konfiguraci zdroje…"
      : `Zdroj není nakonfigurovaný (${required})`;
  return undefined;
}

/** Layers the server can actually serve. A layer gated behind a key the deployment doesn't hold
 *  is hidden rather than shown broken. */
export function availableLayerPlugins(caps: ServerCapabilities | null): MapLayerPlugin[] {
  return runtimeRegistry.available({ server: caps ?? {} }).map(({ value }) => value);
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

/**
 * The layer a shell mode switches on, in canonical v2 terms.
 *
 * Feed is the one mode whose primary layer cannot be read off a v1 manifest, because `LayerMode`
 * has no `feed` member to declare `primaryForModes` against. It opens the community layer: the
 * posts in the feed list are user pins, so this is what makes tapping one show it on the map.
 */
export function primaryLayerForAppMode(mode: AppMode): string {
  return mode === "feed" ? "user-layers" : primaryLayerForMode(legacyLayerModeFor(mode));
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

/** The state a layer starts in when it is switched on.
 *
 *  Owned by the plugin rather than by the store, which used to special-case `osm-poi` and
 *  `weather` by id — every layer with a non-trivial default needed another branch there. */
export function initialLayerState(layerId: string): {
  visible: true;
  opacity: number;
  filters: FilterValues;
} {
  const plugin = runtimeRegistry.get(layerId)?.value;
  return {
    visible: true,
    opacity: plugin?.defaultOpacity ?? 1,
    filters: { ...(plugin?.defaultFilters ?? {}) }
  };
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
  runtimeRegistry.clear();
}
