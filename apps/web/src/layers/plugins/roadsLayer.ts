import type maplibregl from "maplibre-gl";
import { registerLayer } from "../registry";
import { createVectorTileOverlay } from "../vectorTileOverlay";

/**
 * Roads and highways, from OpenFreeMap's keyless OpenMapTiles planet set.
 *
 * The basemap already draws roads, so this is not for ordinary viewing: it is for reading the
 * road network as a layer — which classes exist, how they connect — and for the case where the
 * chosen background is a satellite or terrain sheet with no road structure of its own. Colour is
 * the OpenMapTiles class, so the legend states exactly what each line is.
 *
 * The tiles are the same planet set the Liberty/Positron styles use, so this adds no new upstream
 * dependency; it simply draws one vector layer from it with our own styling.
 */

const PLANET_TILES = ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"];

/** Class → colour and width, ordered from the largest road down. OpenMapTiles' `class` values
 *  are the schema's own, so the legend names the same things the tiles contain. */
const CLASS_STYLES: Array<{ id: string; color: string; width: number[] }> = [
  { id: "motorway", color: "#dc2626", width: [1, 0.8, 14, 4.5] },
  { id: "trunk", color: "#ea580c", width: [1, 0.7, 14, 3.5] },
  { id: "primary", color: "#f59e0b", width: [1, 0.6, 14, 3] },
  { id: "secondary", color: "#eab308", width: [1, 0.5, 14, 2.2] },
  { id: "tertiary", color: "#a3a3a3", width: [1, 0.4, 14, 1.6] },
  { id: "minor", color: "#737373", width: [1, 0.25, 14, 0.9] },
  { id: "service", color: "#9ca3af", width: [1, 0.2, 14, 0.6] },
  { id: "path", color: "#22c55e", width: [1, 0.2, 14, 0.5] },
  { id: "track", color: "#65a30d", width: [1, 0.2, 14, 0.5] },
  { id: "rail", color: "#0891b2", width: [1, 0.3, 14, 0.9] }
];

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "roads",
    name: "Silnice a dálnice",
    icon: "🛣️",
    color: "#f59e0b",
    category: "transport",
    description:
      "Silniční síť z OpenMapTiles (OpenFreeMap) jako samostatný překryv. Vhodné nad leteckým nebo terénním podkladem; barva odpovídá třídě komunikace."
  },
  filters: [
    {
      id: "class",
      label: "Třída komunikace",
      kind: "multi-select",
      options: [
        { id: "motorway", label: "Dálnice" },
        { id: "trunk", label: "Rychlostní silnice" },
        { id: "primary", label: "Silnice I. třídy" },
        { id: "secondary", label: "Silnice II. třídy" },
        { id: "tertiary", label: "Silnice III. třídy" },
        { id: "minor", label: "Místní komunikace" },
        { id: "service", label: "Obslužné komunikace" },
        { id: "path", label: "Pěšiny" },
        { id: "track", label: "Polní a lesní cesty" }
      ],
      default: ["motorway", "trunk", "primary", "secondary", "tertiary"]
    }
  ],
  defaultFilters: { class: ["motorway", "trunk", "primary", "secondary", "tertiary"] },
  defaultOpacity: 0.9,
  legend: {
    type: "categorical",
    title: "Třída komunikace",
    items: CLASS_STYLES.filter((entry) => entry.id !== "rail").map((entry) => ({
      label: classLabel(entry.id),
      color: entry.color
    }))
  },
  create: (ctx) =>
    createVectorTileOverlay(ctx.map, ctx.layerId, {
      tiles: PLANET_TILES,
      minzoom: 4,
      maxzoom: 14,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
        '<a href="https://openfreemap.org/">OpenFreeMap</a>',
      groupFilterId: "class",
      defaultGroups: ["motorway", "trunk", "primary", "secondary", "tertiary"],
      sublayers: CLASS_STYLES.map((entry) => ({
        id: entry.id,
        type: "line" as const,
        sourceLayer: "transportation",
        group: entry.id,
        // Each class is its own sublayer so the legend's colour matches exactly the class the
        // reader chose; OpenMapTiles writes the class value itself.
        filter: ["==", ["get", "class"], entry.id] as maplibregl.FilterSpecification,
        paint: {
          "line-color": entry.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], ...entry.width]
        }
      }))
    }),
  attribution: [
    {
      label: "© OpenStreetMap přispěvatelé",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL-1.0"
    },
    { label: "OpenFreeMap", url: "https://openfreemap.org/", license: "OpenMapTiles" }
  ]
});

function classLabel(id: string): string {
  return (
    {
      motorway: "Dálnice",
      trunk: "Rychlostní silnice",
      primary: "Silnice I. třídy",
      secondary: "Silnice II. třídy",
      tertiary: "Silnice III. třídy",
      minor: "Místní komunikace",
      service: "Obslužné komunikace",
      path: "Pěšiny",
      track: "Polní a lesní cesty",
      rail: "Železnice"
    }[id] ?? id
  );
}
