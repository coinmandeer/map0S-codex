const DIRECT_BASEMAP_PROVIDERS: Readonly<Record<string, string>> = {
  "carto-voyager": "carto-browser",
  "carto-dark": "carto-browser",
  "openfreemap-liberty": "openfreemap-browser",
  "openfreemap-positron": "openfreemap-browser",
  "osm-carto": "osm-browser",
  opentopomap: "opentopomap-browser",
  "eox-s2cloudless": "eox-browser",
  "eox-terrain": "eox-browser",
  "esri-imagery": "esri-browser",
  "gibs-viirs": "nasa-gibs-browser"
};

/**
 * Returns only code-reviewed, direct-browser providers. Keyed/proxied basemaps deliberately
 * return null because their external hop is already measured by the API provider telemetry.
 */
export function directBrowserBasemapProviderId(basemapId: string): string | null {
  return DIRECT_BASEMAP_PROVIDERS[basemapId] ?? null;
}

const BASEMAP_SOURCE_IDS = new Set(["basemap", "labels", "osm", "dark"]);

/**
 * MapLibre reports overlay and WebGL failures through the same error channel as style/tile
 * failures. Attribute only fixed basemap source IDs, plus an error while the initial style itself
 * is not loaded. This avoids turning an unrelated layer failure into a provider outage.
 */
export function isBasemapRuntimeError(input: {
  sourceId: unknown;
  styleLoaded: boolean;
  hasPendingBasemap: boolean;
}): boolean {
  if (typeof input.sourceId === "string" && BASEMAP_SOURCE_IDS.has(input.sourceId)) return true;
  return input.sourceId == null && !input.styleLoaded && input.hasPendingBasemap;
}
