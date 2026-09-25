import type { StyleSpecification } from "maplibre-gl";

/** Raster styles have no fonts of their own, yet pins, cluster counts and stop numbers are
 *  symbol layers. Without a glyph endpoint MapLibre rejects every `text-field` layer on a raster
 *  basemap, silently. OpenFreeMap already serves the vector basemaps and carries Noto Sans. */
export const RASTER_STYLE_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Soft raster fallbacks — used only if the vector style JSON can't be fetched at all
 * (see MapCore's `error` handler). */
export const MAP_STYLE_RASTER_FALLBACK: StyleSpecification = {
  version: 8,
  glyphs: RASTER_STYLE_GLYPHS,
  name: "MapOS Tourist Fallback",
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap",
      maxzoom: 19
    }
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#E8F0E8" } },
    {
      id: "osm-raster",
      type: "raster",
      source: "osm",
      paint: { "raster-saturation": -0.25, "raster-contrast": 0.08, "raster-brightness-min": 0.05 }
    }
  ]
};

export const MAP_STYLE_RASTER_FALLBACK_DARK: StyleSpecification = {
  version: 8,
  glyphs: RASTER_STYLE_GLYPHS,
  name: "MapOS Dark Fallback",
  sources: {
    dark: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}@2x.png"
      ],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap contributors",
      maxzoom: 20
    }
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0d0d0d" } },
    { id: "dark-raster", type: "raster", source: "dark", paint: { "raster-brightness-max": 0.9 } }
  ]
};
