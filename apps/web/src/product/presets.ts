import type { FilterValues, OsmPoiCategoryId } from "@mapos/layer-sdk";
import type { IconName } from "../ui/kit/icons";

/**
 * The use-case presets: data, not UI.
 *
 * They live in `product/` rather than under `ui/` because the store applies them (and reads the
 * deep-link `?preset=` against them), and the architecture check keeps `store/` out of `ui/`.
 * The layer drawer and the preset strip render this same list.
 */
export interface MapPreset {
  id: string;
  name: string;
  description: string;
  /** Emoji, used where a preset appears inside map content (Discover's use-case row). */
  icon: string;
  /** Material Symbols name for the chrome (§2.3) — the layers drawer and the top bar. */
  symbol: IconName;
  layers: string[];
  categories?: OsmPoiCategoryId[];
  /** Initial filter values beyond the POI categories, per layer. A preset only declares the
   *  values it wants to differ from the layer's own defaults, so plugin default changes flow
   *  through automatically (a single filter keyed to the shared datasource, §2.4). */
  filters?: Record<string, FilterValues>;
  /** Basemap a usecase works best on. Left unchanged when absent or when the deployment cannot
   *  serve the given basemap (keyed providers). */
  basemap?: string;
  /** What the catalog offers for this usecase — the drawer scope. Never applied to the map. */
  available?: string[];
  /** Layers a usecase must not switch off (community pins the user built up, saved places). */
  keep?: string[];
  /** Opens the statistics explorer (Data usecase) instead of a plain map layer. */
  openStatistics?: boolean;
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "day-trip",
    name: "Výlet",
    description: "Hrady, vyhlídky, voda, vrcholy a přírodní parky",
    icon: "🧭",
    symbol: "hiking",
    layers: ["osm-poi"],
    basemap: "opentopomap",
    categories: [
      "castle",
      "palace",
      "ruins",
      "viewpoint",
      "lake",
      "peak",
      "observation_tower",
      "nature_park",
      "parking",
      "museum"
    ]
  },
  {
    id: "city",
    name: "Město",
    description: "Kavárny, obchody, jídlo, kultura, bary a pivovary",
    icon: "🏙",
    symbol: "location_city",
    layers: ["osm-poi", "events"],
    categories: ["cafe", "shop", "restaurant", "bar", "brewery", "museum", "monument", "parking"],
    available: [
      "osm-poi",
      "events",
      "shared-mobility",
      "roads",
      "webcams",
      "street-objects",
      "live-aircraft",
      "live-vessels",
      "weather-"
    ]
  },
  {
    id: "travel",
    name: "Cestování",
    description: "Kempy, služby a otevřená vanlife místa",
    icon: "🚐",
    symbol: "airport_shuttle",
    layers: ["osm-poi", "vanlife", "refuge-restrooms"],
    categories: [
      "camp_site",
      "caravan_site",
      "shelter",
      "fuel",
      "charging",
      "drinking_water",
      "toilets",
      "shower",
      "dump_station",
      "parking"
    ],
    available: [
      "osm-poi",
      "vanlife",
      "refuge-restrooms",
      "park4night",
      "openrailwaymap",
      "roads",
      "weather"
    ]
  },
  {
    id: "sport",
    name: "Sport",
    description: "Ferraty, lezení, skateparky, koupaliště",
    icon: "🧗",
    symbol: "sports_gymnastics",
    // Trail overlays turn a set of points into something you can actually plan around: the
    // ferrata is only useful next to the path that reaches it.
    layers: ["osm-poi", "waymarked-trails", "opensnowmap"],
    basemap: "opentopomap",
    categories: [
      "via_ferrata",
      "climbing",
      "disc_golf",
      "skatepark",
      "swimming",
      "fitness_trail",
      "fitness_centre",
      "sports_centre"
    ],
    filters: { "waymarked-trails": { activity: ["hiking", "cycling", "mtb", "slopes"] } },
    available: ["osm-poi", "waymarked-trails", "opensnowmap", "cyclosm", "snow-cover"]
  },
  {
    id: "planet",
    name: "Planeta",
    description: "Živá Země — počasí, požáry, zemětřesení, chráněná území",
    icon: "🌍",
    symbol: "explore",
    layers: ["weather-radar", "eonet", "geology", "natura2000", "land-cover"],
    basemap: "gibs-viirs",
    filters: {
      eonet: { category: ["wildfires", "volcanoes", "earthquakes", "severeStorms"] }
    },
    available: [
      "weather-",
      "eonet",
      "geology",
      "natura2000",
      "land-cover",
      "snow-cover",
      "emodnet-bathymetry",
      "cams-air-quality",
      "europe-drought",
      "active-fires",
      "earthquakes",
      "satellites",
      "inaturalist",
      "gbif",
      "gbif-density",
      "ebird"
    ]
  },
  {
    id: "game",
    name: "Hra",
    description: "3D svět, keše, zóny a questy",
    icon: "🎮",
    symbol: "stadia_controller",
    layers: ["game", "game-quests"],
    filters: { "game-quests": { sources: ["opencaching", "turf-zones"] } },
    available: ["game", "game-quests", "temporary-messages", "map-notes"]
  },
  {
    id: "data",
    name: "Data",
    description: "Statistiky, srovnání území a tematické mapy",
    icon: "📊",
    symbol: "bar_chart",
    layers: [],
    basemap: "openfreemap-positron",
    openStatistics: true,
    available: [
      "theme-",
      "tables-",
      "osm-poi",
      "webcams",
      "mapillary",
      "panoramax",
      "live-aircraft",
      "live-vessels"
    ]
  }
];

export const CATEGORY_GROUPS = [
  { id: "nature", label: "Příroda" },
  { id: "culture", label: "Kultura" },
  { id: "food", label: "Jídlo" },
  { id: "services", label: "Služby" },
  { id: "stay", label: "Ubytování" },
  { id: "sport", label: "Sport" }
] as const;
