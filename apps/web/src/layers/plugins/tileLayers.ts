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

function tilePlugin(args: {
  id: string;
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
  name: "CyclOSM",
  icon: "🚲",
  color: "#7c3aed",
  description: "Cyklistická mapa: stezky, pruhy, povrchy a servis kol",
  category: "outdoor",
  attributionLabel: "CyclOSM",
  attributionUrl: "https://www.cyclosm.org/",
  spec: {
    tiles: subdomains("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"),
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
  spec: {
    tiles: ["https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, dlaždice <a href="https://waymarkedtrails.org/">Waymarked Trails</a> (CC-BY-SA)`,
    // One layer, five route networks: picking the activity swaps the tile URL rather than
    // registering five near-identical layers.
    tilesForFilters: (filters) => {
      const raw = filters.activity;
      const activity = Array.isArray(raw) ? raw[0] : raw;
      const allowed = ["hiking", "cycling", "mtb", "riding", "slopes"];
      const chosen =
        typeof activity === "string" && allowed.includes(activity) ? activity : "hiking";
      return [`https://tile.waymarkedtrails.org/${chosen}/{z}/{x}/{y}.png`];
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
  spec: {
    tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, <a href="https://www.openseamap.org/">OpenSeaMap</a>`
  }
});

tilePlugin({
  id: "opentopomap",
  name: "Topografická",
  icon: "⛰️",
  color: "#65a30d",
  description: "Vrstevnice, stínovaný reliéf a turistické cesty",
  category: "outdoor",
  attributionLabel: "OpenTopoMap",
  attributionUrl: "https://opentopomap.org/",
  license: "CC-BY-SA-3.0",
  spec: {
    tiles: subdomains("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"),
    // OpenTopoMap renders to z17 and asks that clients not request beyond it.
    maxzoom: 17,
    attribution: `${OSM_CREDIT}, <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)`
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
  spec: {
    tiles: ["https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: `${OSM_CREDIT}, <a href="https://www.opensnowmap.org/">OpenSnowMap</a>`
  }
});
