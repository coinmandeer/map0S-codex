import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

// Official Terrascope WMTS capabilities, verified 2026-09-24. KVP supports HTTPS/CORS;
// the advertised REST template currently returns 400. Images are for display, not sampling.
const credit =
  "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium";
export const WORLD_COVER_TILES =
  "https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&FORMAT=image%2Fpng&TILEMATRIXSET=EPSG%3A3857&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&TIME=2021-01-01";
const classes = [
  ["Stromy", "#006400"],
  ["Křoviny", "#ffbb22"],
  ["Travní porost", "#ffff4c"],
  ["Orná půda", "#f096ff"],
  ["Zástavba", "#fa0000"],
  ["Holá nebo řídce porostlá půda", "#b4b4b4"],
  ["Sníh a led", "#f0f0f0"],
  ["Trvalá voda", "#0064c8"],
  ["Bylinné mokřady", "#0096a0"],
  ["Mangrovy", "#00cf75"],
  ["Mechy a lišejníky", "#fae6a0"]
];
registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "esa-worldcover",
    name: "Pokryv krajiny — ESA 2021",
    icon: "🌍",
    color: "#006400",
    category: "environment",
    description:
      "ESA WorldCover 2021 v200, klasifikace krajiny v rozlišení 10 m. Pokrytí 60° j. š. až 83° s. š.; přibližte mapu alespoň na úroveň 6. Historická mapa, nikoli aktuální stav. Dlaždice jsou ilustrační; nelze z nich odečítat numerické hodnoty."
  },
  defaultOpacity: 0.7,
  legend: {
    type: "categorical",
    title: "ESA WorldCover · 2021 · 10 m",
    items: classes.map(([label, color]) => ({ label: label!, color: color! }))
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: [WORLD_COVER_TILES],
      minzoom: 6,
      maxzoom: 14,
      bounds: [-180, -60, 180, 83],
      tileSize: 256,
      attribution: credit
    }),
  attribution: [
    { label: credit, url: "https://esa-worldcover.org/en/data-access", license: "CC-BY-4.0" }
  ]
});
