import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import { registerLayer } from "./registry";
import "./plugins/tileLayers";
import "./plugins/dataLayers";
import { createPinsLayerHandle } from "./pinsLayer";
import { createWeatherLayerHandle } from "./weatherLayer";
import { LazyHandle } from "./lazyHandle";

/**
 * The layers MapOS ships with. Each one is a plain object: nothing here is special-cased in the
 * engine, so a fork adds a layer by calling `registerLayer` with the same shape.
 */

const OSM_ATTRIBUTION = {
  label: "© OpenStreetMap přispěvatelé",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL-1.0"
};

registerLayer({
  kind: "pins",
  manifest: {
    id: "osm-poi",
    name: "OSM POI",
    icon: "📍",
    color: "#3b82f6",
    description: "Hrady, vyhlídky, parkování, bary a další z OpenStreetMap",
    category: "travel",
    modes: ["poi", "discover"],
    primaryForModes: ["poi", "discover"]
  },
  filters: [
    {
      id: "categories",
      label: "Kategorie",
      kind: "multi-select",
      options: Object.entries(OSM_POI_CATEGORIES).map(([id, c]) => ({ id, label: c.label })),
      default: ["castle", "viewpoint", "parking"]
    }
  ],
  // Toggling a POI source has to invalidate the cache rather than reuse the old fusion, so the
  // enabled set belongs in the filters that form the cache key.
  deriveFilters: (filters, ctx) => ({ ...filters, sources: ctx.enabledPoiSources }),
  reportsSourceStatus: true,
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [OSM_ATTRIBUTION]
});

registerLayer({
  kind: "pins",
  manifest: {
    id: "user-layers",
    name: "Moje vrstvy",
    icon: "✏️",
    color: "#10b981",
    description: "Vlastní piny a sdílené vrstvy",
    category: "user",
    modes: ["mine"],
    primaryForModes: ["mine"]
  },
  deriveFilters: (filters, ctx) => ({
    ...filters,
    ...(ctx.activeTag ? { tag: ctx.activeTag } : {}),
    ...(ctx.countryCode ? { country: ctx.countryCode } : {})
  }),
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color)
});

registerLayer({
  kind: "raster",
  manifest: {
    id: "weather",
    name: "Počasí",
    icon: "🌧️",
    color: "#6366f1",
    description: "Radar, teplota, vítr a další vrstvy",
    category: "weather",
    modes: ["weather"],
    primaryForModes: ["weather"]
  },
  filters: [{ id: "opacity", label: "Průhlednost", kind: "range", min: 0.2, max: 1, default: 0.6 }],
  create: (ctx) => createWeatherLayerHandle(ctx.map, ctx.layerId),
  attribution: [
    { label: "RainViewer", url: "https://www.rainviewer.com/" },
    { label: "Open-Meteo", url: "https://open-meteo.com/", license: "CC-BY-4.0" }
  ]
});

registerLayer({
  kind: "custom-gl",
  manifest: {
    id: "game",
    name: "QuestLayer",
    icon: "🎮",
    color: "#f59e0b",
    description: "3D questy, ghost zóny a Aavegotchi svět",
    category: "game",
    modes: ["game"],
    primaryForModes: ["game"]
  },
  create: (ctx) =>
    new LazyHandle(async () => {
      const { createGameLayerHandle } = await import("./game/gameLayer");
      return createGameLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId);
    })
});

registerLayer({
  kind: "pins",
  manifest: {
    id: "park4night",
    name: "Park4Night",
    icon: "🚐",
    color: "#0EA5A4",
    description: "Tábořiště a parkovací místa pro karavany (neoficiální zdroj, prototyp)",
    category: "travel",
    experimental: true
  },
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color)
});
