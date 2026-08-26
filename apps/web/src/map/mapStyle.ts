import type { StyleSpecification } from "maplibre-gl";

/** Free, no-API-key CARTO GL vector basemaps. Keeping the basemap keyless is deliberate: a
 * fresh clone has to render a map without anybody signing up for anything. */
export const CARTO_VOYAGER_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
export const CARTO_DARK_MATTER_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Soft raster fallbacks — used only if the vector style JSON can't be fetched at all
 * (see MapCore's `error` handler). */
export const MAP_STYLE_RASTER_FALLBACK: StyleSpecification = {
  version: 8,
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

/** Mapy.com raster basemap, served through the API proxy so the key stays server-side.
 *  Attribution text is mandatory under Mapy's terms and the visible logo control is added
 *  separately by MapCore (see MapyLogoControl) — both must be present whenever this is used. */
export function mapyStyle(
  apiBase: string,
  mapset: "basic" | "outdoor" | "winter" | "aerial",
  theme: "light" | "dark"
): StyleSpecification {
  return {
    version: 8,
    name: `Mapy.com ${mapset}`,
    sources: {
      mapy: {
        type: "raster",
        tiles: [`${apiBase}/mapy/tiles/${mapset}/{z}/{x}/{y}?retina=1`],
        tileSize: 256,
        attribution: '<a href="https://mapy.com/" target="_blank">© Seznam.cz a.s.</a> a další',
        maxzoom: 19
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": theme === "dark" ? "#0d0d0d" : "#f8f5ef" }
      },
      {
        id: "mapy-raster",
        type: "raster",
        source: "mapy",
        // Mapy's rasters are designed for a white page. In dark mode a mild dim keeps the
        // amber accents and game overlay legible on top without inverting the map's colours.
        paint:
          theme === "dark"
            ? { "raster-brightness-max": 0.82, "raster-saturation": -0.12 }
            : { "raster-saturation": 0.04 }
      }
    ]
  };
}

export const MAP_STYLE_RASTER_FALLBACK_DARK: StyleSpecification = {
  version: 8,
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
