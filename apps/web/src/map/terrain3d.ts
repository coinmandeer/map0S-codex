import type maplibregl from "maplibre-gl";

/**
 * Elevation, from the Tilezen terrain tiles on AWS Open Data.
 *
 * Unlike the extruded buildings, this does not depend on what the active background ships:
 * the DEM is its own global, keyless source, so switching terrain on works over CARTO, over
 * aerial imagery and over a national topographic map alike. That is the point — the mountains
 * are a property of the world, not of the picture chosen to draw it.
 *
 * The tiles are `terrarium`-encoded, where a pixel means
 * `(R * 256 + G + B / 256) - 32768` metres. MapLibre's default is Mapbox's encoding, and getting
 * this wrong produces silently wrong heights rather than an error, so the source states it.
 *
 * A hillshade layer comes with it. Terrain alone only reads as relief when the camera is
 * tilted; hillshade gives the same information from directly above, which is how most of the
 * map is actually looked at.
 */

export const TERRAIN_SOURCE_ID = "mapos-terrain-dem";
export const HILLSHADE_LAYER_ID = "mapos-hillshade";

/** Tilezen's terrain tiles: bare-earth heights, no key, ODbL/CC-BY depending on the contributing
 *  dataset. 256 px PNGs, global, useful to about z14. */
const TERRARIUM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];

/** Enough to make hills read without turning gentle country into a relief model. */
const EXAGGERATION = 1.25;

function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

function ensureSource(map: maplibregl.Map): void {
  if (map.getSource(TERRAIN_SOURCE_ID)) return;
  map.addSource(TERRAIN_SOURCE_ID, {
    type: "raster-dem",
    tiles: TERRARIUM_TILES,
    tileSize: 256,
    maxzoom: 14,
    encoding: "terrarium",
    attribution:
      '<a href="https://registry.opendata.aws/terrain-tiles/">Tilezen Terrain Tiles</a>, ' +
      "NASA SRTM, ESA, USGS"
  });
}

/** Idempotent: safe to call on every style load and on every toggle. */
export function applyTerrain3d(map: maplibregl.Map, enabled: boolean): void {
  if (!enabled) {
    // Order matters: the mesh has to be released before the source it reads from, or MapLibre
    // keeps a reference to a source that is no longer in the style.
    if (map.getTerrain()) map.setTerrain(null);
    if (map.getLayer(HILLSHADE_LAYER_ID)) map.removeLayer(HILLSHADE_LAYER_ID);
    if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
    return;
  }

  ensureSource(map);

  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: TERRAIN_SOURCE_ID,
        paint: {
          "hillshade-exaggeration": 0.45,
          "hillshade-shadow-color": "#4a4235",
          "hillshade-highlight-color": "#fffdf7",
          "hillshade-accent-color": "#6b6252"
        }
      },
      firstSymbolLayerId(map)
    );
  }

  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: EXAGGERATION });
}
