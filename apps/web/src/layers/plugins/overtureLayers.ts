import { registerLayer } from "../registry";
import { createVectorTileOverlay } from "../vectorTileOverlay";

/**
 * Overture places and buildings, as a self-hosted PMTiles overlay.
 *
 * Why this does not point at Overture's public PMTiles directly: those archives are built for
 * data inspection, not map cartography. A single z14 tile over central Prague is ~8.5 MB and
 * carries over 10 000 places, and the buildings tiles are comparable. Reading that in a browser
 * as the reader pans would stall the map and dominate the network — exactly the kind of
 * regression the redesign is meant to prevent.
 *
 * So this follows the plan's own instruction — "vlastní omezený import pro produkci" — and reads a
 * bounded archive we host: a small extract for the area an operator chooses, served from
 * `/overture/{places,buildings}.pmtiles`. The capability gate means the rows simply do not appear
 * until such an extract exists, so nothing here is a dead toggle or a broken promise.
 *
 * The import that produces the archives lives in `scripts/import-overture.mjs` and uses DuckDB to
 * read only the requested bounding box out of the global GeoParquet release.
 */

/** The archive is served by our own origin, so it needs no external host in the rights inventory
 *  and cannot leak a request to Overture per pan. */
function archiveUrl(theme: string): string[] {
  return [`pmtiles:///overture/${theme}.pmtiles`];
}

const OVERTURE_ATTRIBUTION =
  '© <a href="https://docs.overturemaps.org/attribution" target="_blank">Overture Maps Foundation</a>';

/** Both layers are gated on a capability the server only reports once its import exists. */
const CAPABILITY = "overture";

registerLayer({
  kind: "raster",
  minQueryZoom: 12,
  geometryKinds: ["Point", "VectorTile"],
  renderer: { type: "symbols" },
  areaFilter: "context",
  manifest: {
    id: "overture-places",
    name: "Overture Places",
    icon: "🏬",
    color: "#7c3aed",
    category: "community",
    requiresCapability: CAPABILITY,
    description:
      "Místa z omezeného výřezu Overture Maps, který provozuje tato instalace. Nejde o globální pokrytí; rozsah určuje správce importu."
  },
  defaultOpacity: 1,
  legend: {
    type: "categorical",
    title: "Overture · kategorie",
    items: [
      { label: "Jídlo a pití", color: "#f97316" },
      { label: "Nákupy", color: "#ec4899" },
      { label: "Služby a byznys", color: "#14b8a6" },
      { label: "Zdraví", color: "#ef4444" },
      { label: "Vzdělání", color: "#3b82f6" },
      { label: "Kultura a zábava", color: "#eab308" },
      { label: "Ubytování", color: "#a855f7" },
      { label: "Sport", color: "#22c55e" },
      { label: "Doprava", color: "#0ea5e9" },
      { label: "Ostatní", color: "#7c3aed" }
    ]
  },
  create: (ctx) =>
    createVectorTileOverlay(ctx.map, ctx.layerId, {
      tiles: archiveUrl("places"),
      minzoom: 12,
      maxzoom: 14,
      attribution: OVERTURE_ATTRIBUTION,
      sublayers: [
        ...[
          ["food_and_drink", "#f97316", "restaurant"],
          ["shopping", "#ec4899", "shop"],
          ["services_and_business", "#14b8a6", "default"],
          ["health_care", "#ef4444", "health"],
          ["education", "#3b82f6", "school"],
          ["arts_and_entertainment", "#eab308", "museum"],
          ["lodging", "#a855f7", "alpine_hut"],
          ["sports_and_recreation", "#22c55e", "sport"],
          ["travel_and_transportation", "#0ea5e9", "parking"],
          ["other", "#7c3aed", "default"]
        ].map(([category, color, glyph]) => ({
          id: `place-${category}`,
          type: "symbol" as const,
          sourceLayer: "place",
          minzoom: 12,
          filter: (category === "other"
            ? [
                "!",
                [
                  "in",
                  ["get", "category"],
                  [
                    "literal",
                    [
                      "food_and_drink",
                      "shopping",
                      "services_and_business",
                      "health_care",
                      "education",
                      "arts_and_entertainment",
                      "lodging",
                      "sports_and_recreation",
                      "travel_and_transportation"
                    ]
                  ]
                ]
              ]
            : ["==", ["get", "category"], category]) as import("maplibre-gl").FilterSpecification,
          pin: { color: color!, glyph: glyph! },
          interactive: true,
          paint: { "icon-opacity": 0.95 }
        }))
      ]
    }),
  attribution: [
    {
      label: "Overture Maps Foundation · Places",
      url: "https://docs.overturemaps.org/attribution",
      license: "ODbL / CDLA-Permissive (dle zdroje)"
    }
  ]
});

registerLayer({
  kind: "raster",
  geometryKinds: ["Polygon", "VectorTile"],
  renderer: { type: "vector-style" },
  areaFilter: "context",
  manifest: {
    id: "overture-buildings",
    name: "Overture Buildings",
    icon: "🏢",
    color: "#8b5cf6",
    category: "community",
    requiresCapability: CAPABILITY,
    description:
      "Obrysy budov z omezeného výřezu Overture Maps, který provozuje tato instalace. Slouží k porovnání s podkladem."
  },
  defaultOpacity: 0.5,
  legend: {
    type: "categorical",
    title: "Overture · budovy",
    items: [{ label: "Obrys budovy", color: "#8b5cf6" }]
  },
  create: (ctx) =>
    createVectorTileOverlay(ctx.map, ctx.layerId, {
      tiles: archiveUrl("buildings"),
      minzoom: 12,
      maxzoom: 14,
      attribution: OVERTURE_ATTRIBUTION,
      sublayers: [
        {
          id: "building",
          type: "fill" as const,
          sourceLayer: "building",
          minzoom: 12,
          paint: { "fill-color": "#8b5cf6", "fill-opacity": 0.35 }
        },
        {
          id: "building-outline",
          type: "line" as const,
          sourceLayer: "building",
          minzoom: 14,
          paint: { "line-color": "#6d28d9", "line-width": 0.6, "line-opacity": 0.7 }
        }
      ]
    }),
  attribution: [
    {
      label: "Overture Maps Foundation · Buildings",
      url: "https://docs.overturemaps.org/attribution",
      license: "ODbL / CDLA-Permissive (dle zdroje)"
    }
  ]
});
