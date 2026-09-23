import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

/**
 * Self-hosted "funny social maps" — raster PMTiles archives.
 *
 * These are the plan's tier-2 raster images: one picture that describes a region (an election
 * map, a wine/beer cartoon of Europe, a pharmacy-density chart), tiled into a single PMTiles
 * archive by `scripts/tile-raster-image.mjs` and served from our own origin at
 * `/layers/*.pmtiles`. Reading it costs only the tiles in view, and the browser never talks to
 * an external host.
 *
 * The archive is read through the globally registered `pmtiles://` protocol, exactly like the
 * Overture extracts; `bounds` below matches the archive's own bbox so the map does not fetch
 * tiles outside the image.
 */
export interface FunnyMapSpec {
  id: string;
  name: string;
  icon: string;
  /** Path relative to the public root, e.g. `/layers/wine-map.pmtiles`. */
  archive: string;
  /** [west, south, east, north] — must match the bbox the archive was tiled from. */
  bounds: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
  description?: string;
  attribution?: string;
  defaultOpacity?: number;
}

export function registerFunnyMapLayer(spec: FunnyMapSpec): void {
  registerLayer({
    kind: "raster",
    areaFilter: "context",
    manifest: {
      id: spec.id,
      name: spec.name,
      icon: spec.icon,
      color: "#0ea5e9",
      category: "statistics",
      description: spec.description ?? "Obrázková mapa z vlastního archivu této instalace."
    },
    defaultOpacity: spec.defaultOpacity ?? 0.85,
    create: (ctx) =>
      createTileLayer(ctx.map, ctx.layerId, {
        tiles: [`pmtiles://${spec.archive}`],
        bounds: spec.bounds,
        minzoom: spec.minzoom ?? 0,
        maxzoom: spec.maxzoom ?? 10,
        attribution: spec.attribution
      }),
    attribution: [{ label: spec.name, license: "provided by this installation's operator" }]
  });
}
