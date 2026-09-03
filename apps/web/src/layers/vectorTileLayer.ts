import type maplibregl from "maplibre-gl";
import type { LayerHandle } from "@mapos/layer-sdk";
import { createVectorTileOverlay } from "./vectorTileOverlay";

/**
 * Overlays that arrive as vector tiles rather than pictures, where the tile carries its own
 * colour and one fill says everything.
 *
 * The reason to have this alongside `createTileLayer` is that the colours live in the data. A
 * geological map ships each polygon with the shade its survey assigned it, so the style is
 * `["get", "color"]` and one layer renders thousands of distinct units — something a raster tile
 * can also do, but then the polygons are pixels and nothing can be clicked, filtered or dimmed
 * independently.
 *
 * Overlays whose tile holds several unrelated things, each needing its own drawing rule, want
 * `createVectorTileOverlay` instead; this is the one-fill case expressed through it.
 */

export interface VectorTileLayerSpec {
  tiles: string[];
  /** The layer name inside the tile, e.g. Macrostrat's `units`. */
  sourceLayer: string;
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
  /** Fill colour, usually a data expression reading a property the tile carries. */
  fillColor: maplibregl.ExpressionSpecification | string;
  /** Drawn on top of the fill to separate neighbouring polygons of similar colour. */
  outlineColor?: maplibregl.ExpressionSpecification | string;
}

export function createVectorTileLayer(
  map: maplibregl.Map,
  layerId: string,
  spec: VectorTileLayerSpec
): LayerHandle {
  return createVectorTileOverlay(map, layerId, {
    tiles: spec.tiles,
    minzoom: spec.minzoom,
    maxzoom: spec.maxzoom,
    attribution: spec.attribution,
    sublayers: [
      {
        id: "fill",
        type: "fill",
        sourceLayer: spec.sourceLayer,
        paint: { "fill-color": spec.fillColor }
      },
      ...(spec.outlineColor
        ? [
            {
              id: "line",
              type: "line" as const,
              sourceLayer: spec.sourceLayer,
              paint: {
                "line-color": spec.outlineColor,
                "line-width": 0.6,
                // The outline exists to separate neighbours, not to compete with the fill.
                "line-opacity": 0.7
              }
            }
          ]
        : [])
    ]
  });
}
