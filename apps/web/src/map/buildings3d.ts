import type maplibregl from "maplibre-gl";

/**
 * Extruded buildings, drawn from whatever the active background already ships.
 *
 * Every OpenMapTiles-schema style (CARTO, OpenFreeMap, MapTiler) carries a `building` source
 * layer with a `render_height`, so 3D is a matter of asking for it rather than of loading more
 * data. Raster backgrounds have no geometry at all, which is why this quietly does nothing
 * there instead of reporting an error the user can't act on.
 */

export const BUILDINGS_LAYER_ID = "mapos-3d-buildings";

/** Warm stone by day, slate by night: a light block on a dark basemap glows like a lamp. */
const BUILDING_COLORS = {
  light: { low: "#d6d0c4", high: "#b9b2a5" },
  dark: { low: "#2b3140", high: "#454d60" }
} as const;

export function buildingPaint(theme: "light" | "dark" = "light") {
  const colors = BUILDING_COLORS[theme] ?? BUILDING_COLORS.light;
  const height: maplibregl.ExpressionSpecification = [
    "coalesce",
    ["get", "render_height"],
    ["get", "height"],
    ["*", ["coalesce", ["get", "building:levels"], 2], 3]
  ];
  return {
    // Height is the one attribute worth trusting across providers; where it is missing the
    // block still gets a floor's worth of extrusion so the roofline doesn't disappear.
    "fill-extrusion-height": height,
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
    // Taller blocks read slightly darker, so a skyline has depth instead of one flat colour.
    "fill-extrusion-color": ["interpolate", ["linear"], height, 0, colors.low, 60, colors.high],
    "fill-extrusion-vertical-gradient": true,
    // Fading in over two zoom levels hides the moment blocks pop into existence.
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.78]
  } as maplibregl.FillExtrusionLayerSpecification["paint"];
}

/** The vector source carrying building polygons, found by looking at what the style actually
 *  has rather than by assuming a source name — those differ between providers. */
function buildingSource(map: maplibregl.Map): { source: string; sourceLayer: string } | null {
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    if (layer.id === BUILDINGS_LAYER_ID) continue;
    const sourceLayer = (layer as { "source-layer"?: string })["source-layer"];
    const source = (layer as { source?: string }).source;
    if (sourceLayer === "building" && source) return { source, sourceLayer };
  }
  return null;
}

/** Where to insert the extrusions: under the first symbol layer, so street and place labels
 *  stay readable on top of the blocks. */
function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
}

export function supports3dBuildings(map: maplibregl.Map): boolean {
  return Boolean(buildingSource(map));
}

/** Idempotent: safe to call on every style load and on every toggle. */
export function apply3dBuildings(
  map: maplibregl.Map,
  enabled: boolean,
  theme: "light" | "dark" = "light"
): void {
  const existing = map.getLayer(BUILDINGS_LAYER_ID);
  if (!enabled) {
    if (existing) map.removeLayer(BUILDINGS_LAYER_ID);
    return;
  }
  if (existing) return;

  const found = buildingSource(map);
  if (!found) return;

  map.addLayer(
    {
      id: BUILDINGS_LAYER_ID,
      type: "fill-extrusion",
      source: found.source,
      "source-layer": found.sourceLayer,
      minzoom: 14,
      paint: buildingPaint(theme)
    },
    firstSymbolLayerId(map)
  );
}
