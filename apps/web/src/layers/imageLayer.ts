import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

/**
 * Tier 1 raster: one image drawn over its four map corners.
 *
 * For pictures that describe a region rather than tile detail — an election map, a "who drinks
 * what" cartoon of Europe, a pharmacy-density chart — MapLibre's `ImageSource` is the whole
 * story: one fetch, no pyramid, no tile server. The image is stretched between four coordinates
 * (clockwise from the top-left corner), so the caller supplies the georeference it has; an
 * image with no georeference has no place on a map.
 */
export interface ImageLayerSpec {
  url: string;
  /** [west, south, east, north] — the four corners are derived from it. */
  bounds: Bbox;
  /** Shown in the map's attribution control. */
  attribution?: string;
}

export function createImageLayer(
  map: maplibregl.Map,
  layerId: string,
  spec: ImageLayerSpec
): LayerHandle {
  const sourceId = `source-image-${layerId}`;
  const rasterId = `image-${layerId}`;

  let visible = true;
  let opacity = 1;
  let detached = false;

  function firstSymbolLayerId(): string | undefined {
    return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  }

  function ensureLayer() {
    // Same contract as the tile factory: a style switch wipes runtime layers, so presence is
    // re-checked rather than tracked.
    if (map.getSource(sourceId) && map.getLayer(rasterId)) return;
    if (map.getLayer(rasterId)) map.removeLayer(rasterId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    const [west, south, east, north] = spec.bounds;
    map.addSource(sourceId, {
      type: "image",
      url: spec.url,
      // The four corners, clockwise from the top-left (§4.9).
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south]
      ],
      ...(spec.attribution ? { attribution: spec.attribution } : {})
    });
    map.addLayer(
      {
        id: rasterId,
        type: "raster",
        source: sourceId,
        layout: { visibility: visible ? "visible" : "none" },
        paint: { "raster-opacity": opacity }
      },
      firstSymbolLayerId()
    );
  }

  return {
    async update(
      _bbox: Bbox,
      _filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      if (detached || signal?.aborted) return null;
      ensureLayer();
      // The image is fetched by MapLibre; there is nothing for the results list or the cache.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      if (map.getLayer(rasterId)) {
        map.setLayoutProperty(rasterId, "visibility", next ? "visible" : "none");
      }
    },
    setOpacity(next: number) {
      opacity = next;
      if (map.getLayer(rasterId)) map.setPaintProperty(rasterId, "raster-opacity", next);
    },
    detach() {
      detached = true;
      if (map.getLayer(rasterId)) map.removeLayer(rasterId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
