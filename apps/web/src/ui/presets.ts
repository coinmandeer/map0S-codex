import type { OsmPoiCategoryId } from "@mapos/layer-sdk";

export interface PinStyle {
  color: string;
  label: string;
  icon: string;
  group: string;
}

export const PIN_STYLES: Record<string, PinStyle> = {
  aircraft: { color: "#0EA5E9", label: "Letadlo", icon: "✈", group: "transport" },
  "aircraft-ground": { color: "#64748B", label: "Letadlo na zemi", icon: "✈", group: "transport" },
  vessel: { color: "#0F766E", label: "Loď", icon: "⚓", group: "transport" },
  viewpoint: { color: "#0D9488", label: "Vyhlídka", icon: "△", group: "nature" },
  waterfall: { color: "#0891B2", label: "Vodopád", icon: "≈", group: "nature" },
  lake: { color: "#0284C7", label: "Voda", icon: "○", group: "nature" },
  peak: { color: "#57534E", label: "Vrchol", icon: "▲", group: "nature" },
  observation_tower: { color: "#0F766E", label: "Rozhledna", icon: "⌁", group: "nature" },
  nature_park: { color: "#15803D", label: "Přírodní park", icon: "♧", group: "nature" },
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
  shop: { color: "#7C3AED", label: "Obchod", icon: "▤", group: "services" },
  cannabis: { color: "#16A34A", label: "Cannabis prodejna", icon: "▤", group: "services" },
  "weed-dispensary": { color: "#0F766E", label: "Léčebná výdejna", icon: "✚", group: "services" },
  "weed-shop": { color: "#16A34A", label: "Rekreační prodejna", icon: "▤", group: "services" },
  "weed-both": { color: "#7C3AED", label: "Léčebná i rekreační", icon: "✚", group: "services" },
  "weed-unknown": { color: "#64748B", label: "Typ neuveden", icon: "?", group: "services" },
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
  fitness_centre: { color: "#4D7C0F", label: "Posilovna", icon: "◆", group: "sport" },
  disc_golf: { color: "#0D9488", label: "Disc golf", icon: "🥏", group: "sport" },
  golf: { color: "#15803D", label: "Golf", icon: "⛳", group: "sport" },
  skatepark: { color: "#7C3AED", label: "Skatepark", icon: "🛹", group: "sport" },
  swimming: { color: "#0284C7", label: "Koupaliště", icon: "🏊", group: "sport" },
  sports_centre: { color: "#4338CA", label: "Sportoviště", icon: "🏟", group: "sport" },
  "user-pin": { color: "#059669", label: "Můj pin", icon: "★", group: "user" },
  airport: { color: "#1D4ED8", label: "Letiště", icon: "✈", group: "services" },
  helipad: { color: "#2563EB", label: "Heliport", icon: "✈", group: "services" },
  bitcoin_atm: { color: "#F7931A", label: "Bitcoinmat", icon: "₿", group: "services" },
  bitcoin: { color: "#F7931A", label: "Platba Bitcoinem", icon: "₿", group: "services" },
  atm: { color: "#2563EB", label: "Bankomat", icon: "🏧", group: "services" },
  bank: { color: "#1E40AF", label: "Banka", icon: "🏦", group: "services" },
  lighthouse: { color: "#B45309", label: "Maják", icon: "🗼", group: "nature" },
  caravan_site: { color: "#0E7490", label: "Stání pro karavany", icon: "🚐", group: "stay" },
  dump_station: { color: "#7C3AED", label: "Výlevka", icon: "🛢", group: "services" },
  "p4n-camping": { color: "#0EA5A4", label: "Kemp (P4N)", icon: "🚐", group: "p4n" },
  "p4n-parking": { color: "#0891B2", label: "Parkování (P4N)", icon: "🚐", group: "p4n" },
  "p4n-aire": { color: "#0D9488", label: "Servisní místo (P4N)", icon: "🚐", group: "p4n" },
  // These two arrive from `codeToCategory` like the rest; without an entry their pins fell
  // through to the generic colour, so "nocování povoleno" looked like an unclassified place —
  // and that is the distinction someone looking for somewhere to sleep is looking for.
  "p4n-night": { color: "#0F766E", label: "Nocování povoleno (P4N)", icon: "🚐", group: "p4n" },
  "p4n-accommodation": {
    color: "#0369A1",
    label: "Placené ubytování (P4N)",
    icon: "🚐",
    group: "p4n"
  },
  "p4n-other": { color: "#14B8A6", label: "Místo (P4N)", icon: "🚐", group: "p4n" },
  // Quest anchors. The four external sources produce categories of their own, and telling a
  // geocache apart from a note that needs answering is the whole choice a player makes.
  geocache: { color: "#7C3AED", label: "Keš", icon: "◈", group: "quest" },
  survey: { color: "#2563EB", label: "Ověřit v mapě", icon: "?", group: "quest" },
  territory: { color: "#DB2777", label: "Zóna k zabrání", icon: "⬡", group: "quest" }
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

// The preset catalogue is data owned by the product, not by this UI module; the store applies
// presets and the architecture check keeps `store/` out of `ui/`. Re-exported here so the drawer,
// the strip and existing importers keep one import path.
export { MAP_PRESETS, CATEGORY_GROUPS, type MapPreset } from "../product/presets";
