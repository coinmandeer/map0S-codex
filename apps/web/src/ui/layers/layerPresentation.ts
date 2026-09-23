import type { LayerCategory, OsmPoiCategoryId } from "@mapos/layer-sdk";
import type { IconName } from "../kit";

/** Icons for the layers drawer, keyed by layer id with a category fallback.
 *
 *  The manifests carry emoji (`🌋`, `🚐`) because they are shared with the API and with
 *  exported layer packages, where a Material Symbols ligature would mean nothing. The chrome
 *  rule (§2.3) is one icon family, so the mapping from data to glyph lives here instead —
 *  a layer that is not listed still gets a sensible icon from its category.
 */
const LAYER_ICONS: Record<string, IconName> = {
  "osm-poi": "place",
  "user-layers": "edit",
  "my-saved-places": "bookmark",
  weather: "rainy",
  game: "stadia_controller",
  park4night: "rv_hookup",
  vanlife: "airport_shuttle",
  earthquakes: "volcano",
  events: "event",
  geology: "landscape",
  inaturalist: "pets",
  gbif: "eco",
  "air-quality": "air",
  openaq: "air",
  "commons-photos": "photo_camera",
  mapillary: "photo_library",
  panoramax: "photo_library",
  "snow-cover": "snowing",
  roads: "add_road",
  "live-aircraft": "flight",
  "live-vessels": "directions_boat",
  "land-cover": "forest",
  satellites: "satellite_alt",
  "overture-places": "storefront",
  "overture-buildings": "apartment",
  "street-objects": "signpost",
  "temporary-messages": "campaign",
  "refuge-restrooms": "wc",
  "charging-stations": "ev_station",
  "active-fires": "thunderstorm",
  "europe-drought": "water_drop",
  "emodnet-bathymetry": "waves",
  ebird: "pets",
  cyclosm: "directions_bike",
  "waymarked-trails": "hiking",
  openrailwaymap: "train",
  openseamap: "directions_boat",
  opentopomap: "terrain",
  opensnowmap: "downhill_skiing"
};

const CATEGORY_ICONS: Record<LayerCategory, IconName> = {
  travel: "airport_shuttle",
  outdoor: "hiking",
  transport: "directions_bus",
  environment: "eco",
  community: "group",
  weather: "rainy",
  game: "stadia_controller",
  user: "person",
  routing: "route",
  statistics: "bar_chart"
};

/** One hue per data domain (§2.2). Returned as the token name so light/dark follow the theme. */
const CATEGORY_COLORS: Record<LayerCategory, string> = {
  travel: "var(--layer-stay)",
  outdoor: "var(--layer-nature)",
  transport: "var(--layer-services)",
  environment: "var(--layer-nature)",
  community: "var(--layer-user)",
  weather: "var(--layer-weather)",
  game: "var(--layer-game)",
  user: "var(--layer-user)",
  routing: "var(--layer-services)",
  statistics: "var(--layer-services)"
};

export function layerIcon(layerId: string, category: LayerCategory): IconName {
  return LAYER_ICONS[layerId] ?? CATEGORY_ICONS[category] ?? "layers";
}

export function layerDomainColor(category: LayerCategory): string {
  return CATEGORY_COLORS[category] ?? "var(--layer-poi)";
}

/** Chip icons for the OSM POI categories. Same reasoning as `LAYER_ICONS`. */
const POI_CATEGORY_ICONS: Record<OsmPoiCategoryId, IconName> = {
  viewpoint: "landscape",
  waterfall: "waves",
  lake: "water",
  peak: "terrain",
  observation_tower: "cell_tower",
  nature_park: "park",
  cave: "forest",
  castle: "castle",
  palace: "account_balance",
  ruins: "church",
  museum: "museum",
  monument: "attractions",
  bar: "local_bar",
  cafe: "local_cafe",
  restaurant: "restaurant",
  brewery: "sports_bar",
  shop: "storefront",
  parking: "local_parking",
  fuel: "local_gas_station",
  charging: "ev_station",
  drinking_water: "water_full",
  toilets: "wc",
  shower: "shower",
  camp_site: "cottage",
  caravan_site: "rv_hookup",
  dump_station: "water_drop",
  alpine_hut: "cabin",
  shelter: "night_shelter",
  via_ferrata: "hiking",
  climbing: "sports_gymnastics",
  fitness_trail: "directions_walk",
  fitness_centre: "fitness_center",
  disc_golf: "sports_soccer",
  golf: "sports_golf",
  skatepark: "skateboarding",
  swimming: "pool",
  sports_centre: "sports_soccer",
  airport: "connecting_airports",
  helipad: "flight",
  atm: "local_atm",
  bank: "account_balance",
  lighthouse: "light_mode",
  bitcoin_atm: "account_balance_wallet",
  bitcoin: "payments"
};

/** Categories that are not OSM POI ids (live traffic) still get a fitting glyph. */
const LIVE_CATEGORY_ICONS: Record<string, IconName> = {
  aircraft: "flight",
  "aircraft-ground": "flight",
  vessel: "directions_boat"
};

export function poiCategoryIcon(id: string): IconName {
  return POI_CATEGORY_ICONS[id as OsmPoiCategoryId] ?? LIVE_CATEGORY_ICONS[id] ?? "place";
}

/** Second line of a POI layer row: where the data comes from and anything blocking it.
 *  One line, max two facts — the row is 48 px and the description belongs in the InfoTip. */
export function layerRowSubtitle(input: {
  description: string;
  experimental?: boolean;
  locked?: boolean;
}): string {
  const firstSentence = input.description.split(/[.·]/)[0]?.trim() ?? input.description;
  const flags = [
    ...(input.locked ? ["potřebuje klíč"] : []),
    ...(input.experimental ? ["beta"] : [])
  ];
  return flags.length ? `${firstSentence} · ${flags.join(" · ")}` : firstSentence;
}

export interface DrawerSummaryInput {
  /** POI and thematic layers switched on in this drawer. */
  layerCount: number;
  /** Structural overlays switched on in the basemaps drawer; they count towards the badge. */
  overlayCount: number;
  weatherOn: boolean;
  /** Features currently rendered in the viewport across all active layers. */
  featureCount: number;
}

/** The drawer footer (§4.7). Says what is on and roughly how much is drawn, so the user can
 *  tell "nothing here" apart from "nothing switched on". */
export function drawerSummary({
  layerCount,
  overlayCount,
  weatherOn,
  featureCount
}: DrawerSummaryInput): string {
  const total = layerCount + overlayCount + (weatherOn ? 1 : 0);
  if (total === 0) return "Nic není zapnuté";
  const parts = [`Zapnuto ${total} ${plural(total, "vrstva", "vrstvy", "vrstev")}`];
  if (featureCount > 0) {
    parts.push(`~${featureCount} ${plural(featureCount, "bod", "body", "bodů")} ve výřezu`);
  }
  return parts.join(" · ");
}

/** Czech has three grammatical numbers for counted nouns; a naive `n + "vrstvy"` reads wrong
 *  at exactly the counts a layers drawer produces most often. */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

export function categoryCountLabel(count: number): string {
  return `${count} ${plural(count, "kategorie", "kategorie", "kategorií")}`;
}
