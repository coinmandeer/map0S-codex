import type { FilterValues } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { createTileLayer, subdomains, type TileLayerSpec } from "../tileLayer";

/**
 * Keyless raster overlays.
 *
 * Every source here is community-run and free to use within its tile usage policy — no
 * registration, so a fresh clone gets all of them. They are deliberately all `experimental: false`
 * only where the upstream is stable enough to rely on.
 */

const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Raster maps that describe map structure rather than feature records. They stay additive, but
 * their controls belong beside the base map instead of in the ordinary Layers integrations list.
 */
export const STRUCTURAL_TILE_OVERLAY_IDS = [
  "cyclosm",
  "waymarked-trails",
  "openrailwaymap",
  "openseamap",
  "opensnowmap"
] as const;

export type StructuralTileOverlayId = (typeof STRUCTURAL_TILE_OVERLAY_IDS)[number];

const STRUCTURAL_TILE_OVERLAY_ID_SET = new Set<string>(STRUCTURAL_TILE_OVERLAY_IDS);

export function isStructuralTileOverlayId(id: string): id is StructuralTileOverlayId {
  return STRUCTURAL_TILE_OVERLAY_ID_SET.has(id);
}

function tilePlugin(args: {
  id: StructuralTileOverlayId;
  name: string;
  icon: string;
  color: string;
  description: string;
  category: "outdoor" | "transport" | "travel" | "environment";
  spec: TileLayerSpec;
  filters?: Parameters<typeof registerLayer>[0]["filters"];
  defaultFilters?: FilterValues;
  attributionLabel: string;
  attributionUrl: string;
  license?: string;
  legend: Parameters<typeof registerLayer>[0]["legend"];
}) {
  registerLayer({
    kind: "raster",
    manifest: {
      id: args.id,
      name: args.name,
      icon: args.icon,
      color: args.color,
      description: args.description,
      category: args.category
    },
    filters: args.filters,
    defaultFilters: args.defaultFilters,
    legend: args.legend,
    create: (ctx) => createTileLayer(ctx.map, ctx.layerId, args.spec),
    attribution: [
      { label: args.attributionLabel, url: args.attributionUrl, license: args.license },
      {
        label: "© OpenStreetMap přispěvatelé",
        url: "https://www.openstreetmap.org/copyright",
        license: "ODbL-1.0"
      }
    ]
  });
}

tilePlugin({
  id: "cyclosm",
  name: "Cyklistická infrastruktura",
  icon: "🚲",
  color: "#7c3aed",
  description: "Průhledný CyclOSM Lite: cyklistické stezky a infrastruktura nad vaším podkladem",
  category: "outdoor",
  attributionLabel: "CyclOSM",
  attributionUrl: "https://www.cyclosm.org/",
  license: "CC-BY-SA-2.0",
  // Upstream renders far more than this. A legend that repeated the whole style sheet would be
  // a document, so each of these lists the handful of things people actually look for.
  legend: {
    type: "categorical",
    title: "CyclOSM",
    items: [
      { label: "Stezka jen pro kola", color: "#1a73c8" },
      { label: "Pruh v silnici", color: "#4f9ad9" },
      { label: "Sdílená cesta s chodci", color: "#8ab8e0" },
      { label: "Nezpevněný povrch", color: "#b06a3b", description: "Šrafování napříč cestou" },
      { label: "Servis a pumpa", color: "#7c3aed", icon: "pedal_bike" }
    ]
  },
  spec: {
    tiles: subdomains("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png"),
    maxzoom: 20,
    attribution: `${OSM_CREDIT}, dlaždice <a href="https://www.cyclosm.org/">CyclOSM</a>`
  }
});

tilePlugin({
  id: "waymarked-trails",
  name: "Značené trasy",
  icon: "🥾",
  color: "#dc2626",
  description: "Turistické, cyklistické a lyžařské značení z Waymarked Trails",
  category: "outdoor",
  attributionLabel: "Waymarked Trails",
  attributionUrl: "https://waymarkedtrails.org/",
  license: "CC-BY-SA-3.0",
  filters: [
    {
      id: "activity",
      label: "Aktivita",
      kind: "multi-select",
      options: [
        { id: "hiking", label: "Turistika" },
        { id: "cycling", label: "Cyklo" },
        { id: "mtb", label: "MTB" },
        { id: "riding", label: "Jezdecké" },
        { id: "slopes", label: "Sjezdovky" }
      ],
      default: "hiking"
    }
  ],
  defaultFilters: { activity: "hiking" },
  // Waymarked Trails draws by network scale, not by activity, so one key covers all five.
  legend: {
    type: "categorical",
    title: "Značené trasy",
    items: [
      { label: "Mezinárodní trasa", color: "#ff0000" },
      { label: "Národní trasa", color: "#a000c8" },
      { label: "Regionální trasa", color: "#0000ff" },
      { label: "Místní trasa", color: "#00a000" },
      { label: "Více tras v jednom úseku", color: "#7a7a7a", description: "Pruhy vedle sebe" }
    ]
  },
  spec: {
    tiles: ["https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, dlaždice <a href="https://waymarkedtrails.org/">Waymarked Trails</a> (CC-BY-SA)`,
    // One layer, five route networks: picking the activity swaps the tile URL rather than
    // registering five near-identical layers.
    sourcesForFilters: (filters) => {
      const raw = filters.activity ?? "hiking";
      const selected = new Set(Array.isArray(raw) ? raw : [raw]);
      return ["hiking", "cycling", "mtb", "riding", "slopes"]
        .filter((activity) => selected.has(activity))
        .map((activity) => ({
          id: activity,
          tiles: [`https://tile.waymarkedtrails.org/${activity}/{z}/{x}/{y}.png`]
        }));
    }
  }
});

tilePlugin({
  id: "openrailwaymap",
  name: "Železnice",
  icon: "🚆",
  color: "#0891b2",
  description: "Tratě, elektrizace a zabezpečení z OpenRailwayMap",
  category: "transport",
  attributionLabel: "OpenRailwayMap",
  attributionUrl: "https://www.openrailwaymap.org/",
  license: "CC-BY-SA-2.0",
  legend: {
    type: "categorical",
    title: "Železnice",
    items: [
      { label: "Hlavní trať", color: "#ff0000" },
      { label: "Vedlejší trať", color: "#008000" },
      { label: "Vlečka a nákladní kolej", color: "#808080" },
      { label: "Tramvaj a metro", color: "#0000ff" },
      { label: "Nepoužívaná nebo zrušená", color: "#aaaaaa", description: "Čárkovaně" },
      { label: "Stanice a zastávka", color: "#0891b2", icon: "train" }
    ]
  },
  spec: {
    tiles: subdomains("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"),
    maxzoom: 19,
    attribution: `${OSM_CREDIT}, styl <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>`
  }
});

tilePlugin({
  id: "openseamap",
  name: "Námořní mapa",
  icon: "⚓",
  color: "#1d4ed8",
  description: "Bóje, majáky, přístavy a plavební značení",
  category: "transport",
  attributionLabel: "OpenSeaMap",
  attributionUrl: "https://www.openseamap.org/",
  license: "ODbL-1.0",
  legend: {
    type: "icon",
    title: "Námořní značení",
    items: [
      { label: "Maják", icon: "light_mode", color: "#facc15" },
      { label: "Bóje vlevo od plavby", icon: "circle", color: "#dc2626" },
      { label: "Bóje vpravo od plavby", icon: "circle", color: "#16a34a" },
      { label: "Nebezpečí", icon: "warning", color: "#111827" },
      { label: "Přístav a kotviště", icon: "anchor", color: "#1d4ed8" }
    ]
  },
  spec: {
    tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, <a href="https://www.openseamap.org/">OpenSeaMap</a>`
  }
});

tilePlugin({
  id: "opensnowmap",
  name: "Sjezdovky a běžky",
  icon: "⛷️",
  color: "#0ea5e9",
  description: "Sjezdové tratě, běžecké stopy a vleky",
  category: "outdoor",
  attributionLabel: "OpenSnowMap",
  attributionUrl: "https://www.opensnowmap.org/",
  license: "CC-BY-SA-2.0",
  legend: {
    type: "categorical",
    title: "Sjezdovky a běžky",
    items: [
      { label: "Lehká sjezdovka", color: "#2b83ba" },
      { label: "Střední sjezdovka", color: "#d7191c" },
      { label: "Těžká sjezdovka", color: "#1a1a1a" },
      { label: "Běžecká stopa", color: "#7b3294", description: "Tečkovaně" },
      { label: "Vlek a lanovka", color: "#4d4d4d", icon: "airline_seat_recline_extra" }
    ]
  },
  spec: {
    tiles: ["https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, <a href="https://www.opensnowmap.org/">OpenSnowMap</a>`
  }
});
