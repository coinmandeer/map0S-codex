import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

/**
 * Vector tile overlays that need more than one drawing rule.
 *
 * `createVectorTileLayer` covers the case where the tile carries its own colour and one fill
 * says everything. Infrastructure is the other case: a single tile holds power lines, masts,
 * substations and pipelines, and they have to look like different things. Rather than register
 * four near-identical layers over the same source, one layer declares a list of sublayers and a
 * group per sublayer, and the layer's filters decide which groups are drawn.
 *
 * Sublayers go in below the first symbol layer so the basemap's labels stay legible on top.
 */

export type VectorSublayerType = "line" | "fill" | "circle";

export interface VectorSublayerSpec {
  /** Suffix for the MapLibre layer id; unique within the overlay. */
  id: string;
  type: VectorSublayerType;
  /** The layer name inside the tile, e.g. OpenInfraMap's `power_line`. */
  sourceLayer: string;
  /** Which filter group this belongs to; absent means always drawn. */
  group?: string;
  filter?: maplibregl.FilterSpecification;
  minzoom?: number;
  maxzoom?: number;
  paint: Record<string, unknown>;
}

export interface VectorTileOverlaySpec {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
  sublayers: VectorSublayerSpec[];
  /** Filter facet whose value picks the visible groups. Without it every group is drawn. */
  groupFilterId?: string;
  /** Groups drawn when the filter has no usable value. */
  defaultGroups?: string[];
}

/** The paint property that carries opacity, which differs per sublayer type. */
const OPACITY_KEY: Record<VectorSublayerType, string> = {
  line: "line-opacity",
  fill: "fill-opacity",
  circle: "circle-opacity"
};

function readGroups(filters: FilterValues, spec: VectorTileOverlaySpec): Set<string> | null {
  const all = new Set(
    spec.sublayers.map((sublayer) => sublayer.group).filter((group): group is string => !!group)
  );
  if (!spec.groupFilterId) return null;
  const raw = filters[spec.groupFilterId];
  const chosen = (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === "string" && all.has(value));
  if (chosen.length) return new Set(chosen);
  const fallback = spec.defaultGroups?.filter((group) => all.has(group)) ?? [];
  return new Set(fallback.length ? fallback : all);
}

export function createVectorTileOverlay(
  map: maplibregl.Map,
  layerId: string,
  spec: VectorTileOverlaySpec
): LayerHandle {
  const sourceId = `source-vt-${layerId}`;
  const idFor = (sublayer: VectorSublayerSpec) => `vt-${layerId}-${sublayer.id}`;

  let visible = true;
  let opacity = 1;
  let groups: Set<string> | null = readGroups({}, spec);

  function firstSymbolLayerId(): string | undefined {
    return map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
  }

  function shouldDraw(sublayer: VectorSublayerSpec): boolean {
    if (!visible) return false;
    if (!sublayer.group || !groups) return true;
    return groups.has(sublayer.group);
  }

  function removeAll() {
    for (const sublayer of spec.sublayers) {
      const id = idFor(sublayer);
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  function ensureLayers() {
    // A style switch wipes runtime layers, so presence is re-checked rather than remembered.
    const sourceMissing = !map.getSource(sourceId);
    if (sourceMissing) removeAll();

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "vector",
        tiles: spec.tiles,
        minzoom: spec.minzoom ?? 0,
        maxzoom: spec.maxzoom ?? 14,
        attribution: spec.attribution
      });
    }

    const before = firstSymbolLayerId();
    for (const sublayer of spec.sublayers) {
      const id = idFor(sublayer);
      if (map.getLayer(id)) continue;
      map.addLayer(
        {
          id,
          type: sublayer.type,
          source: sourceId,
          "source-layer": sublayer.sourceLayer,
          ...(sublayer.filter ? { filter: sublayer.filter } : {}),
          ...(sublayer.minzoom != null ? { minzoom: sublayer.minzoom } : {}),
          ...(sublayer.maxzoom != null ? { maxzoom: sublayer.maxzoom } : {}),
          layout: { visibility: shouldDraw(sublayer) ? "visible" : "none" },
          paint: {
            ...sublayer.paint,
            [OPACITY_KEY[sublayer.type]]: baseOpacity(sublayer) * opacity
          }
        } as maplibregl.LayerSpecification,
        before
      );
    }
  }

  /** A sublayer may want to sit at less than full strength even when the layer is at 100 %,
   *  e.g. a substation footprint under its own outline. */
  function baseOpacity(sublayer: VectorSublayerSpec): number {
    const declared = sublayer.paint[OPACITY_KEY[sublayer.type]];
    return typeof declared === "number" ? declared : 1;
  }

  function applyVisibility() {
    for (const sublayer of spec.sublayers) {
      const id = idFor(sublayer);
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", shouldDraw(sublayer) ? "visible" : "none");
    }
  }

  return {
    async update(_bbox: Bbox, filters: FilterValues): Promise<FeatureCollection | null> {
      groups = readGroups(filters, spec);
      ensureLayers();
      applyVisibility();
      // MapLibre fetches the tiles, so there is nothing for the results list or the cache.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      applyVisibility();
    },
    setOpacity(next: number) {
      opacity = next;
      for (const sublayer of spec.sublayers) {
        const id = idFor(sublayer);
        if (!map.getLayer(id)) continue;
        map.setPaintProperty(
          id,
          OPACITY_KEY[sublayer.type],
          baseOpacity(sublayer) * next
        );
      }
    },
    detach() {
      removeAll();
    }
  };
}
