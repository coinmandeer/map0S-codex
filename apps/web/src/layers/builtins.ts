import "./plugins/planningEnvironmentLayers";
import "./plugins/gdacsLayer";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import { registerLayer } from "./registry";
import "./plugins/tileLayers";
import "./plugins/czechLayers";
import "./plugins/snowCoverLayer";
import "./plugins/roadsLayer";
import "./plugins/landCoverLayer";
import "./plugins/worldCoverLayer";
import "./plugins/globalEnvironmentLayers";
import "./plugins/overtureLayers";
import "./plugins/streetObjectsLayer";
import "./plugins/liveTraffic";
import "./plugins/mapNotesLayer";
import "./plugins/dataLayers";
import "./plugins/geologyLayer";
import "./plugins/infrastructureLayer";
import "./plugins/protectedAreasLayer";
import "./plugins/europeEnvironmentLayers";
import "./plugins/skyLayers";
import "./plugins/auroraLayer";
import "./plugins/skyAtlasLayer";
import "./plugins/soilGridsLayer";
import "./savedPlacesLayer";
import { createPinsLayerHandle } from "./pinsLayer";
import { createWeatherLayerHandle } from "./weatherLayer";
import {
  WEATHER_VISUALIZATIONS,
  weatherLayerId,
  weatherVisualizationFilters
} from "./weather/controls";
import { createSatelliteLayer } from "./satelliteLayer";
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
  minQueryZoom: 8,
  areaFilter: "geometry",
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
      options: Object.entries(OSM_POI_CATEGORIES)
        .filter(([id]) => id !== "cannabis")
        .map(([id, c]) => ({ id, label: c.label })),
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
  minQueryZoom: 8,
  areaFilter: "geometry",
  kind: "pins",
  manifest: {
    id: "weed",
    name: "weed",
    icon: "🌿",
    color: "#16a34a",
    description:
      "Cannabis prodejny a léčebné výdejny z OpenStreetMap. Typ prodeje je uveden jen tam, kde ho OSM zná; nejde o ověření licence.",
    category: "travel",
    modes: ["discover"],
    uiGroup: "places",
    experienceIds: ["default", "aavegotchi"]
  },
  filters: [
    {
      id: "types",
      label: "Typ prodeje",
      kind: "multi-select",
      options: [
        { id: "dispensary", label: "Léčebná výdejna" },
        { id: "shop", label: "Rekreační prodejna" },
        { id: "both", label: "Léčebná i rekreační" },
        { id: "unknown", label: "Typ neuveden" }
      ],
      default: ["dispensary", "shop", "both", "unknown"]
    }
  ],
  defaultFilters: { types: ["dispensary", "shop", "both", "unknown"] },
  legend: {
    type: "categorical",
    title: "Typ prodeje podle OSM",
    items: [
      { label: "Léčebná výdejna", color: "#0f766e" },
      { label: "Rekreační prodejna", color: "#16a34a" },
      { label: "Léčebná i rekreační", color: "#7c3aed" },
      { label: "Typ neuveden", color: "#64748b" }
    ]
  },
  create: (ctx) => createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, ctx.color),
  attribution: [OSM_ATTRIBUTION]
});

registerLayer({
  areaFilter: "geometry",
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

// One registered layer per weather quantity. They share a renderer, but each is a real layer: its
// own visibility, opacity, filters and legend, so the drawer lists them like any other overlay and
// several can be compared at once. The exclusive radio that used to hide them behind one switch is
// gone on purpose.
const WEATHER_LAYER_ICONS: Record<string, string> = {
  radar: "🌧️",
  precipitation: "☔",
  temperature: "🌡️",
  wind: "💨",
  gusts: "🌀",
  clouds: "☁️",
  pressure: "🧭",
  humidity: "💧"
};

for (const option of WEATHER_VISUALIZATIONS) {
  registerLayer({
    kind: "raster",
    manifest: {
      id: weatherLayerId(option.id),
      name: `Počasí: ${option.label}`,
      icon: WEATHER_LAYER_ICONS[option.id] ?? "🌦️",
      color: "#6366f1",
      description: `${option.label} (${option.unit}). Samostatná vrstva počasí; lze zapnout více typů najednou.`,
      category: "weather",
      uiGroup: "environment",
      temporal: true,
      experienceIds: ["default", "aavegotchi"]
    },
    filters: [
      { id: "opacity", label: "Průhlednost", kind: "range", min: 0.2, max: 1, default: 0.6 },
      { id: "valueLabels", label: "Popisky hodnot při přiblížení", kind: "toggle", default: true }
    ],
    defaultFilters: {
      ...weatherVisualizationFilters({}, option.id),
      valueLabels: true,
      model: "best_match"
    },
    // Radar is a picture, the analytic fields are backgrounds: the radar wants a little more
    // presence, the fields a little less so they do not bury the map.
    defaultOpacity: option.id === "radar" ? 0.7 : 0.55,
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
}

// Satellites are propagated in the browser with SGP4 from CelesTrak elements: the layer shows
// each object's ground track and where it is right now, filtered by category. It is `cheap` for
// panning (the elements do not depend on the viewport) and keeps its own one-second clock.
registerLayer({
  kind: "custom-gl",
  manifest: {
    id: "satellites",
    name: "Družice",
    icon: "🛰️",
    color: "#38bdf8",
    description:
      "Oběžné dráhy a aktuální poloha družic z CelesTrak. Poloha je vypočtená (SGP4) z prvků, jejichž epocha je uvedena u objektu.",
    category: "transport",
    performance: { maxEntities: 600, refreshIntervalMs: 60 * 60_000 }
  },
  detail: {
    fieldOrder: ["altitudeKm", "epoch"]
  },
  filters: [
    {
      id: "categories",
      label: "Kategorie družic",
      kind: "multi-select",
      options: [
        { id: "stations", label: "Stanice" },
        { id: "starlink", label: "Starlink" },
        { id: "oneweb", label: "OneWeb" },
        { id: "gps", label: "Navigace (GPS)" },
        { id: "glonass", label: "Navigace (GLONASS)" },
        { id: "galileo", label: "Navigace (Galileo)" },
        { id: "beidou", label: "Navigace (BeiDou)" },
        { id: "gnss", label: "Navigace (GNSS)" },
        { id: "geo", label: "Geostacionární" },
        { id: "weather", label: "Počasí" },
        { id: "resource", label: "Snímkování Země" },
        { id: "planet", label: "Planet" },
        { id: "iridium", label: "Iridium" },
        { id: "globalstar", label: "Globalstar" },
        { id: "communication", label: "Komunikační" },
        { id: "science", label: "Věda" },
        { id: "military", label: "Vojenské" },
        { id: "sarsat", label: "Záchranná služba" },
        { id: "tdrss", label: "Relé a spojení" },
        { id: "amateur", label: "Amatérské" },
        { id: "visual", label: "Viditelné okem" },
        { id: "cubesat", label: "CubeSaty" },
        { id: "engineering", label: "Technologické" },
        { id: "education", label: "Výukové" },
        { id: "radar", label: "Radarové" }
      ],
      default: ["stations"]
    }
  ],
  defaultFilters: { categories: ["stations"] },
  legend: {
    type: "categorical",
    title: "Kategorie družic",
    items: [
      { label: "Stanice", color: "#f59e0b" },
      { label: "Starlink", color: "#8b5cf6" },
      { label: "OneWeb", color: "#6366f1" },
      { label: "Navigace", color: "#22c55e" },
      { label: "Geostacionární", color: "#eab308" },
      { label: "Počasí", color: "#0284c7" },
      { label: "Snímkování Země", color: "#a3e635" },
      { label: "Iridium / Globalstar", color: "#f472b6" },
      { label: "Věda", color: "#a855f7" },
      { label: "Vojenské", color: "#64748b" },
      { label: "Záchranná služba", color: "#ef4444" },
      { label: "Amatérské", color: "#ec4899" },
      { label: "Viditelné okem", color: "#fde047" },
      { label: "CubeSaty a malé", color: "#94a3b8" }
    ]
  },
  create: (ctx) => createSatelliteLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId),
  attribution: [
    {
      label: "CelesTrak GP (SGP4, vypočtená poloha)",
      url: "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
      license: "CelesTrak GP data — see CelesTrak usage policy"
    }
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
      const { createWorldLayer } = await import("../world/worldLayer");
      return createWorldLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId);
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
    // explicit server capability; the OSM camping categories of `osm-poi` are the keyless fallback.
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

// `vanlife` was retired: it re-queried the camping categories `osm-poi` already offers, so both
// on drew every campsite twice. Old links fold into `osm-poi` (see store/layerAliases.ts).
