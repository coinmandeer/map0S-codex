import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

/**
 * Overlays that arrive as vector tiles rather than pictures.
 *
 * The reason to have this alongside `createTileLayer` is that the colours live in the data. A
 * geological map ships each polygon with the shade its survey assigned it, so the style is
 * `["get", "color"]` and one layer renders thousands of distinct units — something a raster tile
 * can also do, but then the polygons are pixels and nothing can be clicked, filtered or dimmed
 * independently.
 *
 * Like the raster factory, layers go in below the first symbol layer so the basemap's labels stay
 * legible on top.
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
  const sourceId = `source-vt-${layerId}`;
  const fillId = `vt-${layerId}-fill`;
  const lineId = `vt-${layerId}-line`;

  let visible = true;
  let opacity = 1;

  function firstSymbolLayerId(): string | undefined {
    return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  }

  function ensureLayer() {
    // A style switch wipes runtime layers, so presence is re-checked rather than remembered.
    if (map.getSource(sourceId) && map.getLayer(fillId)) return;

    if (map.getLayer(lineId)) map.removeLayer(lineId);
    if (map.getLayer(fillId)) map.removeLayer(fillId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
      type: "vector",
      tiles: spec.tiles,
      minzoom: spec.minzoom ?? 0,
      maxzoom: spec.maxzoom ?? 14,
      attribution: spec.attribution
    });

    const before = firstSymbolLayerId();
    map.addLayer(
      {
        id: fillId,
        type: "fill",
        source: sourceId,
        "source-layer": spec.sourceLayer,
        layout: { visibility: visible ? "visible" : "none" },
        paint: { "fill-color": spec.fillColor, "fill-opacity": opacity }
      },
      before
    );
    if (spec.outlineColor) {
      map.addLayer(
        {
          id: lineId,
          type: "line",
          source: sourceId,
          "source-layer": spec.sourceLayer,
          layout: { visibility: visible ? "visible" : "none" },
          paint: {
            "line-color": spec.outlineColor,
            "line-width": 0.6,
            "line-opacity": opacity * 0.7
          }
        },
        before
      );
    }
  }

  return {
    async update(_bbox: Bbox, _filters: FilterValues): Promise<FeatureCollection | null> {
      ensureLayer();
      // MapLibre fetches the tiles, so there is nothing for the results list or the cache.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      for (const id of [fillId, lineId]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      }
    },
    setOpacity(next: number) {
      opacity = next;
      if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-opacity", next);
      if (map.getLayer(lineId)) map.setPaintProperty(lineId, "line-opacity", next * 0.7);
    },
    detach() {
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
