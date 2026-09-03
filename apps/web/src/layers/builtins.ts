import { OSM_POI_CATEGORIES, VANLIFE_CATEGORIES } from "@mapos/layer-sdk";
import { registerLayer } from "./registry";
import "./plugins/tileLayers";
import "./plugins/dataLayers";
import "./plugins/geologyLayer";
import "./plugins/infrastructureLayer";
import "./plugins/protectedAreasLayer";
import "./savedPlacesLayer";
import { createPinsLayerHandle } from "./pinsLayer";
import { createWeatherLayerHandle } from "./weatherLayer";
import { LazyHandle } from "./lazyHandle";
import { GAME_ROAD_SOURCE } from "./game/roadSource";
import { PIN_STYLES } from "../ui/presets";

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
    modes: ["planning", "discover"],
    primaryForModes: ["planning", "discover"],
    uiGroup: "places",
    experienceIds: ["default", "aavegotchi"]
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
    uiGroup: "community",
    experienceIds: ["default", "aavegotchi"]
  },
  deriveFilters: (filters, ctx) => ({
    ...filters,
    ...(ctx.activeTag ? { tag: ctx.activeTag } : {}),
    ...(ctx.countryCode ? { country: ctx.countryCode } : {})
  }),
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [{ label: "MapOS uživatelská data", license: "per-feature owner rights" }]
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
    uiGroup: "environment",
    temporal: true,
    experienceIds: ["default", "aavegotchi"]
  },
  filters: [
    { id: "opacity", label: "Průhlednost", kind: "range", min: 0.2, max: 1, default: 0.6 },
    { id: "valueLabels", label: "Popisky hodnot při přiblížení", kind: "toggle", default: true }
  ],
  // One exclusive visualization. Legacy keys remain so old weather URLs still resolve safely.
  defaultFilters: { visualization: "radar", radar: true, variable: null, valueLabels: true },
  // Weather is an overlay: at full opacity it hides the map it is supposed to describe.
  defaultOpacity: 0.6,
  create: (ctx) => createWeatherLayerHandle(ctx.map, ctx.layerId),
  attribution: [
    {
      label: "RainViewer",
      url: "https://www.rainviewer.com/",
      license: "RainViewer API Terms"
    },
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
    primaryForModes: ["game"],
    uiGroup: "game",
    experienceIds: ["default", "aavegotchi"],
    performance: { maxEntities: 180, refreshIntervalMs: 30_000 }
  },
  create: (ctx) =>
    new LazyHandle(async () => {
      const { createGameLayerHandle } = await import("./game/gameLayer");
      return createGameLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId);
    }),
  attribution: [...GAME_ROAD_SOURCE.attribution]
});

registerLayer({
  kind: "pins",
  manifest: {
    id: "game-quests",
    name: "Herní questy",
    icon: "🎯",
    color: "#7C3AED",
    description: "Keše, poznámky v mapě, památky bez fotky a Turf zóny jako questy",
    category: "game",
    // Deliberately not limited to the game mode. A geocache and an unanswered OSM note are
    // reasons to walk somewhere whether or not you are playing, and the 3D quest world is a
    // heavy thing to load just to see them.
    modes: ["discover", "planning", "mine", "game"],
    uiGroup: "game",
    performance: { maxEntities: 200, refreshIntervalMs: 120_000 }
  },
  filters: [
    {
      id: "sources",
      label: "Zdroj questů",
      kind: "multi-select",
      options: [
        { id: "opencaching", label: "Keše (Opencaching)" },
        { id: "osm-notes", label: "Poznámky v OSM" },
        { id: "wlm-photo", label: "Památky bez fotky" },
        { id: "turf-zones", label: "Turf zóny" }
      ]
    }
  ],
  legend: {
    type: "categorical",
    title: "Typ questu",
    items: [
      {
        label: "Keš",
        color: PIN_STYLES.geocache!.color,
        description: "Opencaching — najdi schovanou keš"
      },
      {
        label: "Ověřit v mapě",
        color: PIN_STYLES.survey!.color,
        description: "Otevřená poznámka v OSM, kterou někdo potřebuje ověřit"
      },
      {
        label: "Památka bez fotky",
        color: PIN_STYLES.monument!.color,
        description: "Vyfoť ji a nahraj na Wikimedia Commons"
      },
      {
        label: "Zóna k zabrání",
        color: PIN_STYLES.territory!.color,
        description: "Turf zóna"
      }
    ]
  },
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [
    {
      label: "Opencaching",
      url: "https://www.opencaching.de/",
      license: "CC-BY-SA / CC-BY-NC-ND dle instance"
    },
    {
      label: "© OpenStreetMap přispěvatelé",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL"
    },
    {
      label: "Wiki Loves Monuments",
      url: "https://heritage.toolforge.org/",
      license: "CC0"
    },
    { label: "Turf Game", url: "https://turfgame.com/", license: "Turf Game API" }
  ]
});

registerLayer({
  kind: "pins",
  manifest: {
    id: "park4night",
    name: "Park4Night",
    icon: "🚐",
    color: "#0EA5A4",
    description: "Parkovací a kempovací místa z Park4Night pro prototyp",
    category: "travel",
    experimental: true,
    // Prototype policy keeps rights metadata advisory. Availability is controlled only by the
    // explicit server capability; the OSM vanlife layer below remains the keyless fallback.
    requiresCapability: "park4night"
  },
  // The upstream record already carries the category, the rating and five amenity flags, and
  // "a place to sleep tonight with electricity" is the question this layer exists to answer.
  // Filtering happens server-side: narrowing 1000 fetched rows in the browser would cap before
  // filtering and make a filter look like an empty map.
  filters: [
    {
      id: "categories",
      label: "Typ místa",
      kind: "multi-select",
      options: [
        { id: "p4n-camping", label: "Kemp" },
        { id: "p4n-aire", label: "Servisní místo" },
        { id: "p4n-night", label: "Nocování povoleno" },
        { id: "p4n-parking", label: "Parkoviště" },
        { id: "p4n-accommodation", label: "Placené ubytování" },
        { id: "p4n-other", label: "Ostatní" }
      ]
    },
    {
      id: "services",
      label: "Vybavení",
      kind: "multi-select",
      options: [
        { id: "water", label: "Voda" },
        { id: "electricity", label: "Elektřina" },
        { id: "toilets", label: "WC" },
        { id: "shower", label: "Sprcha" },
        { id: "wifi", label: "Wi‑Fi" }
      ]
    },
    // Whole stars: the slider's default step for a 0–5 span, and a finer one would suggest a
    // precision that "places rated 4.5 and up" does not have.
    { id: "minRating", label: "Hodnocení od", kind: "range", min: 0, max: 5, default: 0 }
  ],
  // Without a field order the sheet falls back to the generic place layout, which drops the
  // rating, the amenities and the link back — everything that makes one parking spot a better
  // answer than another. Ordered by what decides it: how good, how many said so, what is there.
  detail: {
    fieldOrder: ["rating", "reviews", "serviceLabels", "externalUrl"],
    aiEnrichment: "on-demand"
  },
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [
    {
      label: "Park4Night",
      url: "https://plus.park4night.com/en/cgu",
      license: "PARK4NIGHT-GTCU-ARTICLE-5-PRIOR-AUTHORIZATION-REQUIRED"
    }
  ]
});

registerLayer({
  kind: "pins",
  manifest: {
    id: "vanlife",
    name: "Karavany a kempy",
    icon: "🚐",
    color: "#0EA5A4",
    description: "Kempy, stání pro obytná auta, výlevky a pitná voda z OpenStreetMap",
    category: "travel",
    modes: ["planning"],
    uiGroup: "travel",
    experienceIds: ["default", "aavegotchi"]
  },
  filters: [
    {
      id: "categories",
      label: "Kategorie",
      kind: "multi-select",
      options: VANLIFE_CATEGORIES.map((id) => ({ id, label: OSM_POI_CATEGORIES[id].label })),
      default: [...VANLIFE_CATEGORIES]
    }
  ],
  // This is a thematic OSM layer, not a second copy of the whole fused catalogue. Keeping it
  // OSM-only also keeps its attribution accurate and prevents community pins from being drawn
  // again underneath the main POI layer.
  deriveFilters: (filters) => ({ ...filters, sources: ["osm"] }),
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [OSM_ATTRIBUTION]
});
