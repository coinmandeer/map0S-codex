import type { OsmPoiCategoryId } from "@mapos/layer-sdk";

export interface PinStyle {
  color: string;
  label: string;
  icon: string;
  group: string;
}

export const PIN_STYLES: Record<string, PinStyle> = {
  viewpoint: { color: "#0D9488", label: "Vyhlídka", icon: "△", group: "nature" },
  waterfall: { color: "#0891B2", label: "Vodopád", icon: "≈", group: "nature" },
  lake: { color: "#0284C7", label: "Voda", icon: "○", group: "nature" },
  peak: { color: "#57534E", label: "Vrchol", icon: "▲", group: "nature" },
  cave: { color: "#78716C", label: "Jeskyně", icon: "∩", group: "nature" },
  castle: { color: "#B7791F", label: "Hrad", icon: "♜", group: "culture" },
  palace: { color: "#92400E", label: "Zámek", icon: "♛", group: "culture" },
  ruins: { color: "#78350F", label: "Zřícenina", icon: "▣", group: "culture" },
  museum: { color: "#A16207", label: "Muzeum", icon: "M", group: "culture" },
  monument: { color: "#854D0E", label: "Pomník", icon: "†", group: "culture" },
  bar: { color: "#E11D48", label: "Bar", icon: "♪", group: "food" },
  cafe: { color: "#EA580C", label: "Kavárna", icon: "☕", group: "food" },
  restaurant: { color: "#DC2626", label: "Restaurace", icon: "🍴", group: "food" },
  brewery: { color: "#CA8A04", label: "Pivovar", icon: "🍺", group: "food" },
  parking: { color: "#475569", label: "Parkování", icon: "P", group: "services" },
  fuel: { color: "#334155", label: "Palivo", icon: "⛽", group: "services" },
  charging: { color: "#16A34A", label: "EV", icon: "⚡", group: "services" },
  drinking_water: { color: "#0EA5E9", label: "Voda", icon: "💧", group: "services" },
  toilets: { color: "#64748B", label: "WC", icon: "WC", group: "services" },
  shower: { color: "#38BDF8", label: "Sprcha", icon: "🚿", group: "services" },
  camp_site: { color: "#15803D", label: "Kemp", icon: "⛺", group: "stay" },
  alpine_hut: { color: "#166534", label: "Chata", icon: "⌂", group: "stay" },
  shelter: { color: "#4D7C0F", label: "Přístřešek", icon: "⊓", group: "stay" },
  via_ferrata: { color: "#B45309", label: "Ferrata", icon: "⛓", group: "sport" },
  climbing: { color: "#9A3412", label: "Lezení", icon: "🧗", group: "sport" },
  fitness_trail: { color: "#65A30D", label: "Fitness", icon: "💪", group: "sport" },
  disc_golf: { color: "#0D9488", label: "Disc golf", icon: "🥏", group: "sport" },
  skatepark: { color: "#7C3AED", label: "Skatepark", icon: "🛹", group: "sport" },
  swimming: { color: "#0284C7", label: "Koupaliště", icon: "🏊", group: "sport" },
  sports_centre: { color: "#4338CA", label: "Sportoviště", icon: "🏟", group: "sport" },
  "user-pin": { color: "#059669", label: "Můj pin", icon: "★", group: "user" },
  "p4n-camping": { color: "#0EA5A4", label: "Kemp (P4N)", icon: "🚐", group: "p4n" },
  "p4n-parking": { color: "#0891B2", label: "Parkování (P4N)", icon: "🚐", group: "p4n" },
  "p4n-aire": { color: "#0D9488", label: "Servisní místo (P4N)", icon: "🚐", group: "p4n" },
  "p4n-other": { color: "#14B8A6", label: "Místo (P4N)", icon: "🚐", group: "p4n" }
};

export function pinColor(category: string | undefined, fallback = "#B7791F"): string {
  if (!category) return fallback;
  return PIN_STYLES[category]?.color ?? fallback;
}

/** Always-visible toggle chips above the map. Everything else lives only in the layers dialog. */
export const PRIMARY_POI_CHIPS: OsmPoiCategoryId[] = [
  "castle",
  "palace",
  "ruins",
  "viewpoint",
  "parking",
  "restaurant",
  "cafe",
  "camp_site"
];

export interface MapPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  layers: string[];
  categories?: OsmPoiCategoryId[];
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "day-trip",
    name: "Výlet",
    description: "Hrady, vyhlídky, parkování",
    icon: "🧭",
    layers: ["osm-poi"],
    categories: ["castle", "palace", "ruins", "viewpoint", "parking", "museum"]
  },
  {
    id: "nature",
    name: "Příroda",
    description: "Vrcholy, voda, vyhlídky",
    icon: "🌲",
    layers: ["osm-poi"],
    categories: ["viewpoint", "waterfall", "lake", "peak", "cave", "alpine_hut"]
  },
  {
    id: "city",
    name: "Město",
    description: "Jídlo, kultura, parkování",
    icon: "🏙",
    layers: ["osm-poi"],
    categories: ["cafe", "restaurant", "bar", "museum", "monument", "parking"]
  },
  {
    id: "camp",
    name: "Kemp",
    description: "Kempování a služby",
    icon: "⛺",
    layers: ["osm-poi"],
    categories: ["camp_site", "shelter", "drinking_water", "shower", "toilets", "parking"]
  },
  {
    id: "gastro",
    name: "Gastro",
    description: "Restaurace, kavárny, bary, pivovary",
    icon: "🍽",
    layers: ["osm-poi"],
    categories: ["restaurant", "cafe", "bar", "brewery"]
  },
  {
    id: "road-services",
    name: "Služby na cestě",
    description: "Palivo, EV, voda, WC, sprchy",
    icon: "⛽",
    layers: ["osm-poi"],
    categories: ["fuel", "charging", "drinking_water", "toilets", "shower", "parking"]
  },
  {
    id: "vanlife",
    name: "Vanlife",
    description: "Kempy a Park4Night místa",
    icon: "🚐",
    layers: ["osm-poi", "park4night"],
    categories: ["camp_site", "shelter", "drinking_water", "parking"]
  },
  {
    id: "sport",
    name: "Sportovní výzvy",
    description: "Ferraty, lezení, skateparky, koupaliště",
    icon: "🧗",
    // Trail overlays turn a set of points into something you can actually plan around: the
    // ferrata is only useful next to the path that reaches it.
    layers: ["osm-poi", "waymarked-trails"],
    categories: [
      "via_ferrata",
      "climbing",
      "disc_golf",
      "skatepark",
      "swimming",
      "fitness_trail",
      "sports_centre"
    ]
  },
  {
    id: "game",
    name: "Noční hra",
    description: "QuestLayer + ghost zóny",
    icon: "🎮",
    layers: ["game", "osm-poi"],
    categories: ["castle", "viewpoint", "museum"]
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
