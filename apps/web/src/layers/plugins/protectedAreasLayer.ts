import type { FilterValues } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";
import { BIRDS, HABITATS, naturaGetMapUrl } from "./protectedAreasSource";

/**
 * Natura 2000 — the EU-wide protected area network, from the EEA.
 *
 * §23 asks for the European source first and a national one only where it is genuinely finer,
 * and protected areas are the clearest case for it: Natura 2000 is a single dataset covering
 * every member state, assembled by the EEA from national submissions. One layer therefore
 * answers "is this protected" across the whole union, instead of the question only working
 * inside whichever countries we had remembered to wire up.
 *
 * The service speaks WMS, and MapLibre can consume that directly: a raster source substitutes
 * `{bbox-epsg-3857}` into the URL, so a GetMap per tile needs no proxy. The template itself is
 * built by `wmsAdapter` — see [./protectedAreasSource.ts](./protectedAreasSource.ts).
 *
 * The two directives are separate WMS layers and are drawn together by default. The combined
 * layer the service also offers (`0`) is a flat magenta fill that hides the map underneath;
 * these two draw as outlines with hatching, so the ground stays readable, which is what an
 * overlay has to do.
 */

function chosenLayers(filters: FilterValues): string[] {
  const raw = filters.directive;
  const chosen = (Array.isArray(raw) ? raw : [raw]).filter(
    (value): value is string => value === "birds" || value === "habitats"
  );
  const wms = [
    ...(chosen.includes("habitats") ? [HABITATS] : []),
    ...(chosen.includes("birds") ? [BIRDS] : [])
  ];
  return wms.length ? wms : [HABITATS, BIRDS];
}

registerLayer({
  kind: "raster",
  manifest: {
    id: "natura2000",
    name: "Chráněná území",
    icon: "🌿",
    color: "#16a34a",
    description: "Natura 2000 — evropská síť chráněných území podle obou směrnic",
    category: "environment"
  },
  filters: [
    {
      id: "directive",
      label: "Směrnice",
      kind: "multi-select",
      options: [
        { id: "habitats", label: "Přírodní stanoviště" },
        { id: "birds", label: "Ptačí oblasti" }
      ]
    },
    { id: "opacity", label: "Průhlednost", kind: "range", min: 0.2, max: 1, default: 0.8 }
  ],
  defaultFilters: { directive: ["habitats", "birds"] },
  defaultOpacity: 0.8,
  // The swatches are the service's own, read off its GetLegendGraphic rather than guessed, so
  // the key matches the pixels exactly. Areas designated under both directives are drawn with
  // both hatchings crossing, which is why that row has no single colour of its own.
  legend: {
    type: "categorical",
    title: "Natura 2000",
    items: [
      {
        label: "Přírodní stanoviště",
        color: "#A7ADF2",
        description: "Směrnice o stanovištích (pSCI, SCI, SAC)"
      },
      { label: "Ptačí oblasti", color: "#E88281", description: "Směrnice o ptácích (SPA)" },
      {
        label: "Obojí",
        color: "#9333ea",
        description: "Území vyhlášené podle obou směrnic — kříží se oba rastry"
      },
      {
        label: "Jen EU",
        color: "#9ca3af",
        description: "Mimo unii vrstva nekreslí nic; jiné země v datech nejsou"
      }
    ]
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: [naturaGetMapUrl([HABITATS, BIRDS])],
      tilesForFilters: (filters) => [naturaGetMapUrl(chosenLayers(filters))],
      attribution:
        'Natura 2000, <a href="https://www.eea.europa.eu/">Evropská agentura pro životní prostředí</a>'
    }),
  attribution: [
    {
      label: "EEA — Natura 2000",
      url: "https://www.eea.europa.eu/legal/copyright",
      license: "EEA standard re-use policy"
    }
  ]
});
