import { BASEMAPS } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";
import { CZECH_BOUNDS, CZECH_LAYERS, CZECH_SOURCES, czechTileUrl } from "./czechSources";

export function useInverseCadastre(theme?: string, basemapId?: string): boolean {
  return theme === "dark" || Boolean(BASEMAPS.find((b) => b.id === basemapId)?.imagery);
}

for (const def of CZECH_LAYERS) {
  const source = CZECH_SOURCES[def.source];
  const network = def.id === "cz-networks";
  registerLayer({
    kind: "raster",
    manifest: {
      id: def.id,
      name: def.cs,
      icon: "🗺️",
      color: "#3976a8",
      category: "environment",
      description: `${def.cs} — ČR, od přiblížení ${def.minZoom}. ${def.note ?? "Informativní mapový podklad; pokrytí a aktuálnost určuje poskytovatel."}`
    },
    minQueryZoom: def.minZoom,
    defaultOpacity: def.opacity,
    defaultFilters: network ? { networks: def.layers } : undefined,
    filters: network
      ? [
          {
            id: "networks",
            label: "Druhy sítí",
            kind: "multi-select",
            options: [
              { id: "el_ved", label: "Elektřina" },
              { id: "el_kom", label: "Telekomunikace" },
              { id: "plyn", label: "Plyn" },
              { id: "voda", label: "Voda" },
              { id: "kan", label: "Kanalizace" },
              { id: "teplo", label: "Teplo" }
            ]
          }
        ]
      : undefined,
    deriveFilters: def.inverse
      ? (filters, ctx) => ({ ...filters, _inverse: useInverseCadastre(ctx.theme, ctx.basemapId) })
      : undefined,
    legend: def.legendUrl
      ? {
          type: "image",
          title: def.cs,
          items: [{ label: def.cs, imageUrl: def.legendUrl }]
        }
      : def.source === "networks" || def.source === "connections"
        ? {
            type: "image",
            title: def.cs,
            items: def.layers.map((layer) => ({
              label: layer,
              imageUrl: `${source.endpoint}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${layer}`
            }))
          }
        : {
            // ČÚZK does not advertise GetLegendGraphic. Do not fabricate coloured swatches.
            type: "categorical",
            title: def.cs,
            items: [
              {
                label: def.cs,
                description:
                  def.note ??
                  (def.inverse
                    ? "Oficiální kresba ČÚZK; světlé linie nad leteckým a tmavým podkladem."
                    : "Oficiální tematická kresba ČÚZK.")
              }
            ]
          },
    attribution: [{ label: source.label, url: source.url, license: source.terms }],
    create: (ctx) =>
      createTileLayer(ctx.map, ctx.layerId, {
        tiles: [czechTileUrl(def)],
        bounds: CZECH_BOUNDS,
        minzoom: def.minZoom,
        maxzoom: 22,
        attribution: `<a href="${source.url}">${source.label}</a>`,
        // Empty selections remove the source rather than accidentally asking WMS for all data.
        sourcesForFilters: (filters) => {
          const selection =
            network && Array.isArray(filters.networks)
              ? def.layers.filter((id) => (filters.networks as unknown[]).includes(id))
              : def.layers;
          return selection.length
            ? [{ id: "map", tiles: [czechTileUrl(def, filters._inverse === true, selection)] }]
            : [];
        }
      })
  });
}
