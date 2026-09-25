import { registerLayer } from "../registry";
import { createVectorTileLayer } from "../vectorTileLayer";

/**
 * The bedrock, from Macrostrat.
 *
 * Macrostrat stitches national geological surveys into one global set of vector tiles, keyless
 * and CC BY. Each polygon carries the colour its own survey gave it, so the fill reads straight
 * from the tile — the map looks like a geological map because it is one, not because we invented
 * a palette for it.
 *
 * The tabs in a place's detail explain what any of it means; see the "Pod nohama" info panel.
 */

registerLayer({
  kind: "raster",
  manifest: {
    id: "geology",
    name: "Geologie",
    icon: "🪨",
    color: "#a16207",
    description: "Horniny a jejich stáří z Macrostratu, s vysvětlením v detailu místa",
    category: "environment"
  },
  filters: [
    { id: "opacity", label: "Průhlednost", kind: "range", min: 0.15, max: 1, default: 0.5 }
  ],
  // At full strength the geology hides the streets you navigate by, and the point is to see both.
  defaultOpacity: 0.5,
  // The fill is whatever colour the polygon arrives with, so this cannot be an exact swatch
  // key — surveys differ in shade. What they agree on is the dimension: colour is age, on the
  // international scheme. Naming the eras is what makes the map readable; claiming a precise
  // hex for each would be inventing a palette we do not control.
  legend: {
    type: "categorical",
    title: "Geologie — barva je věk",
    items: [
      { label: "Kenozoikum", color: "#f2f91d", description: "Posledních 66 mil. let" },
      { label: "Mezozoikum", color: "#67c5ca", description: "66–252 mil. let" },
      { label: "Paleozoikum", color: "#99c08d", description: "252–539 mil. let" },
      { label: "Proterozoikum", color: "#f73563", description: "539–2500 mil. let" },
      { label: "Archaikum", color: "#f0047f", description: "Starší než 2,5 mld. let" },
      {
        label: "Odstín se liší podle služby",
        color: "#9ca3af",
        description: "Každá národní služba kreslí vlastní variantu téže stupnice"
      }
    ]
  },
  create: (ctx) =>
    createVectorTileLayer(ctx.map, ctx.layerId, {
      tiles: ["https://tiles.macrostrat.org/carto/{z}/{x}/{y}.mvt"],
      sourceLayer: "units",
      maxzoom: 13,
      fillColor: ["coalesce", ["get", "color"], "#9ca3af"],
      outlineColor: "rgba(30, 41, 59, 0.35)",
      attribution:
        '<a href="https://macrostrat.org/">Macrostrat</a> (CC BY 4.0), národní geologické služby'
    }),
  attribution: [{ label: "Macrostrat", url: "https://macrostrat.org/", license: "CC-BY-4.0" }]
});
