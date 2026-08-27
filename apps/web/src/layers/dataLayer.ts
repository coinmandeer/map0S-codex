import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";
import { fetchLayerFeatures } from "../engine/LayerEngine";

export interface DataLayerSpec {
  color: string;
  /** Numeric property to scale the circle by — magnitude, capacity. Absent means uniform dots. */
  sizeBy?: { property: string; min: number; max: number; minRadius: number; maxRadius: number };
  /** Show names next to the dots from this zoom. Off by default: for dense layers like species
   *  observations the labels are noise, not information. */
  labelFromZoom?: number;
}

/**
 * Generic point layer for the many external sources that are "a few hundred things with
 * coordinates". Circles rather than pin icons: the colour is the layer's identity, and a
 * bespoke icon set per source would be a lot of design work for very little gain.
 *
 * Layer ids keep the `pins-` prefix because that is what the map's click handling and the
 * engine's teardown both look for.
 */
export function createDataLayer(
  map: maplibregl.Map,
  apiBase: string,
  layerId: string,
  spec: DataLayerSpec
): LayerHandle {
  const sourceId = `source-${layerId}`;
  const circleId = `pins-${layerId}-dot`;
  const labelId = `pins-${layerId}-label`;
  let opacity = 1;
  let visible = true;

  function radiusExpression(): maplibregl.ExpressionSpecification | number {
    if (!spec.sizeBy) return 5;
    const { property, min, max, minRadius, maxRadius } = spec.sizeBy;
    return [
      "interpolate",
      ["linear"],
      // Features missing the property collapse to the smallest dot rather than disappearing.
      ["coalesce", ["to-number", ["get", property]], min],
      min,
      minRadius,
      max,
      maxRadius
    ];
  }

  function ensureLayers() {
    if (map.getSource(sourceId)) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });

    map.addLayer({
      id: circleId,
      type: "circle",
      source: sourceId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "circle-color": spec.color,
        "circle-radius": radiusExpression(),
        "circle-opacity": 0.85 * opacity,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": opacity
      }
    });

    if (spec.labelFromZoom !== undefined) {
      map.addLayer({
        id: labelId,
        type: "symbol",
        source: sourceId,
        minzoom: spec.labelFromZoom,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1],
          "text-anchor": "top",
          "text-max-width": 12,
          "text-font": ["Noto Sans Regular"],
          visibility: visible ? "visible" : "none"
        },
        paint: {
          "text-color": "#1C1917",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4
        }
      });
    }
  }

  const layerIds = [circleId, labelId];

  function setData(data: FeatureCollection) {
    ensureLayers();
    (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData(data);
  }

  return {
    async update(bbox: Bbox, filters: FilterValues, signal?: AbortSignal) {
      ensureLayers();
      const data = await fetchLayerFeatures(apiBase, layerId, bbox, filters, signal);
      setData(data);
      return data;
    },
    setData,
    setVisible(next: boolean) {
      visible = next;
      ensureLayers();
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
        }
      }
    },
    setOpacity(next: number) {
      opacity = next;
      ensureLayers();
      if (map.getLayer(circleId)) {
        map.setPaintProperty(circleId, "circle-opacity", 0.85 * next);
        map.setPaintProperty(circleId, "circle-stroke-opacity", next);
      }
    },
    detach() {
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
