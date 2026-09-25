import { registerLayer } from "../registry";
import { createVectorTileOverlay } from "../vectorTileOverlay";

/**
 * The grid under everything, from OpenInfraMap.
 *
 * OpenInfraMap renders OpenStreetMap's power, telecoms, oil/gas and water networks into one
 * global keyless vector tile set. It ships no style — the site's own is not published — so the
 * colours here are ours, which is why the legend can state them exactly.
 *
 * The service is one person's (Russss) rather than a foundation's, so it gets a narrow zoom
 * window: below z7 a continent of lines is noise anyway, and not requesting those tiles is the
 * polite reading of a service with no published usage policy.
 */

const TILES = ["https://openinframap.org/tiles/{z}/{x}/{y}.pbf"];

/** Colour by voltage. `voltage` arrives as a number in kV, so a step expression reads it
 *  directly. The breaks follow how grids are actually talked about: local distribution, medium
 *  voltage, sub-transmission, transmission, and the long-distance backbone. */
const VOLTAGE_COLOR = [
  "step",
  ["coalesce", ["to-number", ["get", "voltage"], 0], 0],
  "#9ca3af",
  10,
  "#38bdf8",
  50,
  "#22c55e",
  150,
  "#f59e0b",
  300,
  "#ef4444",
  500,
  "#a21caf"
] as const;

/** Thicker with voltage, and thicker with zoom: at z7 a backbone should read as a single line,
 *  at z14 it should look like the corridor it is. */
const VOLTAGE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  7,
  ["step", ["coalesce", ["to-number", ["get", "voltage"], 0], 0], 0.4, 150, 0.9, 300, 1.4],
  14,
  ["step", ["coalesce", ["to-number", ["get", "voltage"], 0], 0], 1.2, 50, 2, 150, 3, 300, 4.5]
] as const;

registerLayer({
  minQueryZoom: 7,
  kind: "raster",
  manifest: {
    id: "openinframap",
    name: "Infrastruktura",
    icon: "⚡",
    color: "#f59e0b",
    description: "Elektrická síť, telekomunikace, plynovody a vodovody z OpenStreetMap",
    category: "transport"
  },
  filters: [
    {
      id: "network",
      label: "Síť",
      kind: "multi-select",
      options: [
        { id: "power", label: "Elektřina" },
        { id: "telecoms", label: "Telekomunikace" },
        { id: "petroleum", label: "Plyn a ropa" },
        { id: "water", label: "Voda" }
      ],
      default: "power"
    }
  ],
  defaultFilters: { network: ["power"] },
  // Lines over a street map need the street map to stay readable underneath.
  defaultOpacity: 0.85,
  legend: {
    type: "categorical",
    title: "Infrastruktura — barva je napětí",
    unit: "kV",
    items: [
      { label: "Do 10 kV — místní rozvod", color: "#9ca3af" },
      { label: "10–50 kV", color: "#38bdf8" },
      { label: "50–150 kV", color: "#22c55e" },
      { label: "150–300 kV", color: "#f59e0b" },
      { label: "300–500 kV", color: "#ef4444" },
      { label: "Nad 500 kV — dálkový přenos", color: "#a21caf" },
      {
        label: "Pod zemí",
        color: "#64748b",
        description: "Čárkovaně; nadzemní vedení plnou linkou"
      },
      { label: "Rozvodna", color: "#f97316", icon: "electrical_services" },
      { label: "Elektrárna", color: "#16a34a", icon: "bolt" },
      { label: "Vysílač", color: "#8b5cf6", icon: "cell_tower" },
      { label: "Plynovod a ropovod", color: "#b45309", description: "Podle látky v potrubí" },
      { label: "Vodovod a kanalizace", color: "#0ea5e9" }
    ]
  },
  create: (ctx) =>
    createVectorTileOverlay(ctx.map, ctx.layerId, {
      tiles: TILES,
      minzoom: 7,
      maxzoom: 17,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
        '<a href="https://openinframap.org/">OpenInfraMap</a>',
      groupFilterId: "network",
      defaultGroups: ["power"],
      sublayers: [
        // Power. Underground cables are dashed so a line crossing a town does not read as a
        // pylon route it is not.
        {
          id: "power-line-underground",
          type: "line",
          sourceLayer: "power_line",
          group: "power",
          filter: ["==", ["get", "location"], "underground"],
          paint: {
            "line-color": VOLTAGE_COLOR,
            "line-width": VOLTAGE_WIDTH,
            "line-dasharray": [2, 1.5]
          }
        },
        {
          id: "power-line",
          type: "line",
          sourceLayer: "power_line",
          group: "power",
          filter: ["!=", ["get", "location"], "underground"],
          paint: { "line-color": VOLTAGE_COLOR, "line-width": VOLTAGE_WIDTH }
        },
        {
          id: "power-plant",
          type: "fill",
          sourceLayer: "power_plant",
          group: "power",
          paint: { "fill-color": "#16a34a", "fill-opacity": 0.35 }
        },
        {
          id: "power-substation",
          type: "fill",
          sourceLayer: "power_substation",
          group: "power",
          paint: { "fill-color": "#f97316", "fill-opacity": 0.45 }
        },
        {
          id: "power-plant-point",
          type: "circle",
          sourceLayer: "power_plant_point",
          group: "power",
          minzoom: 8,
          paint: {
            "circle-color": "#16a34a",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 6],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1
          }
        },
        {
          id: "power-substation-point",
          type: "circle",
          sourceLayer: "power_substation_point",
          group: "power",
          minzoom: 10,
          paint: {
            "circle-color": "#f97316",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 5],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.8
          }
        },
        // Telecoms.
        {
          id: "telecoms-lines",
          type: "line",
          sourceLayer: "telecoms_communication_line",
          group: "telecoms",
          paint: {
            "line-color": "#8b5cf6",
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.2, 14, 3],
            "line-opacity": 0.9
          }
        },
        {
          id: "telecoms-mast",
          type: "circle",
          sourceLayer: "telecoms_mast",
          group: "telecoms",
          minzoom: 9,
          paint: {
            "circle-color": "#8b5cf6",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 15, 5],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.8
          }
        },
        {
          id: "telecoms-data-center",
          type: "circle",
          sourceLayer: "telecoms_data_center",
          group: "telecoms",
          paint: {
            "circle-color": "#7c3aed",
            "circle-radius": 5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5
          }
        },
        // Oil and gas. `substance` distinguishes the two, and which one a pipeline carries is
        // the first thing anyone wants to know about it.
        {
          id: "petroleum-pipeline",
          type: "line",
          sourceLayer: "petroleum_pipeline",
          group: "petroleum",
          paint: {
            "line-color": [
              "match",
              ["get", "substance"],
              "gas",
              "#b45309",
              "oil",
              "#1f2937",
              "#92400e"
            ],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 14, 2.4]
          }
        },
        {
          id: "petroleum-site",
          type: "fill",
          sourceLayer: "petroleum_site",
          group: "petroleum",
          paint: { "fill-color": "#b45309", "fill-opacity": 0.4 }
        },
        {
          id: "petroleum-well",
          type: "circle",
          sourceLayer: "petroleum_well",
          group: "petroleum",
          minzoom: 10,
          paint: {
            "circle-color": "#1f2937",
            "circle-radius": 2.5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.8
          }
        },
        // Water, including the district heating that shares the tag.
        {
          id: "water-pipeline",
          type: "line",
          sourceLayer: "water_pipeline",
          group: "water",
          paint: {
            "line-color": [
              "match",
              ["get", "substance"],
              "sewage",
              "#78716c",
              "hot_water",
              "#dc2626",
              "#0ea5e9"
            ],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.7, 14, 2.2]
          }
        }
      ]
    }),
  attribution: [
    {
      label: "OpenInfraMap",
      url: "https://openinframap.org/copyright",
      license: "CC-BY-4.0"
    },
    {
      label: "© OpenStreetMap přispěvatelé",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL-1.0"
    }
  ]
});
