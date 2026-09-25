import { registerInteractivePins, unregisterInteractivePins } from "../map/interactivePins";
import { ensureDataPinImage, LAYER_GLYPHS } from "../map/pinIcons";
import { namedPointFilter, PIN_LABEL_LAYOUT } from "../map/pinLabels";
import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";
import { fetchLayerFeatures } from "../engine/LayerEngine";

export interface DataLayerSpec {
  color: string;
  /** Optional categorical renderer for semantically important states such as cancelled events. */
  colorBy?: { property: string; values: Record<string, string>; fallback?: string };
  /** Selects the versioned feature envelope; v1 remains the default during migration. */
  contractVersion?: 1 | 2;
  /** Numeric property to scale the pin by — magnitude, capacity. Absent means uniform pins. */
  sizeBy?: { property: string; min: number; max: number; minRadius: number; maxRadius: number };
  /** Show names next to the pins from this zoom. Off by default: for dense layers like species
   *  observations the labels are noise, not information. */
  labelFromZoom?: number;
  /** Group nearby pins into counted bubbles below street zoom. On by default; a layer whose pin
   *  size carries the information (earthquake magnitude) turns it off, because a bubble would
   *  hide exactly that. */
  cluster?: boolean;
}

/** Clustering stops at street zoom, where individual places are what people look for. */
export const DATA_LAYER_CLUSTER_MAX_ZOOM = 14;

export function dataLayerClusters(spec: DataLayerSpec): boolean {
  return spec.cluster ?? !spec.sizeBy;
}

/**
 * Generic point layer for the many external sources that are "a few hundred things with
 * coordinates". Every one renders as a layer-coloured pin that opens the same place sheet (and AI
 * brief) as an OSM pin, so there is one interaction model across all POI layers.
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
  const pinLayerId = `pins-${layerId}-dot`;
  const labelId = `pins-${layerId}-label`;
  const clusterId = `pins-${layerId}-cluster`;
  const countId = `pins-${layerId}-count`;
  // Every point layer clusters unless its pin size is the message. A hand-picked list used to
  // leave most layers unclustered, which is what turned a city centre with a dozen layers on
  // into overlapping pins at every zoom.
  const clustered = dataLayerClusters(spec);
  let opacity = 1;
  let visible = true;

  function iconSizeExpression(): maplibregl.ExpressionSpecification | number {
    if (!spec.sizeBy) return 0.86;
    const { property, min, max, minRadius, maxRadius } = spec.sizeBy;
    return [
      "interpolate",
      ["linear"],
      // Features missing the property collapse to the smallest pin rather than disappearing.
      ["coalesce", ["to-number", ["get", property]], min],
      min,
      Math.max(0.65, minRadius / 16),
      max,
      Math.max(0.65, maxRadius / 16)
    ];
  }

  function ensureLayers() {
    registerInteractivePins(map, layerId, [pinLayerId, labelId]);
    if (map.getSource(sourceId)) return;

    ensureDataPinImage(map, layerId, spec.colorBy?.fallback ?? spec.color);
    const icon: unknown[] = ["match", ["to-string", ["get", spec.colorBy?.property ?? ""]]];
    for (const [value, color] of Object.entries(spec.colorBy?.values ?? {})) {
      const id = `${layerId}-${encodeURIComponent(value)}`;
      ensureDataPinImage(map, id, color, LAYER_GLYPHS[layerId]);
      icon.push(value, `pin-${id}`);
    }
    icon.push(`pin-${layerId}`);

    map.addSource(sourceId, {
      type: "geojson",
      promoteId: "id",
      ...(clustered
        ? { cluster: true, clusterMaxZoom: DATA_LAYER_CLUSTER_MAX_ZOOM, clusterRadius: 45 }
        : {}),
      data: { type: "FeatureCollection", features: [] }
    });

    if (clustered) {
      map.addLayer({
        id: clusterId,
        type: "circle",
        source: sourceId,
        filter: ["has", "point_count"],
        layout: { visibility: visible ? "visible" : "none" },
        paint: {
          "circle-color": spec.color,
          "circle-radius": 18,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": opacity
        }
      });
      map.addLayer({
        id: countId,
        type: "symbol",
        source: sourceId,
        filter: ["has", "point_count"],
        layout: {
          visibility: visible ? "visible" : "none",
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true
        },
        paint: { "text-color": "#ffffff", "text-opacity": opacity }
      });
    }
    map.addLayer({
      id: pinLayerId,
      type: "symbol",
      source: sourceId,
      ...(clustered
        ? { filter: ["!", ["has", "point_count"]] as maplibregl.FilterSpecification }
        : {}),
      layout: {
        visibility: visible ? "visible" : "none",
        "icon-image":
          spec.colorBy && Object.keys(spec.colorBy.values).length
            ? (icon as maplibregl.ExpressionSpecification)
            : ["image", `pin-${layerId}`],
        "icon-size": iconSizeExpression(),
        "icon-anchor": "center",
        // Drawn always, but labels of every layer keep clear of it.
        "icon-allow-overlap": true,
        "icon-ignore-placement": false
      },
      paint: { "icon-opacity": 0.92 * opacity }
    });

    if (spec.labelFromZoom !== undefined) {
      map.addLayer({
        id: labelId,
        type: "symbol",
        source: sourceId,
        minzoom: spec.labelFromZoom,
        filter: namedPointFilter(clustered),
        layout: {
          ...PIN_LABEL_LAYOUT,
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
          "text-halo-width": 1.4,
          "text-opacity": opacity
        }
      });
    }
  }

  const layerIds = [pinLayerId, labelId, clusterId, countId];

  function setData(data: FeatureCollection) {
    ensureLayers();
    (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData(data);
  }

  return {
    async update(bbox: Bbox, filters: FilterValues, signal?: AbortSignal) {
      ensureLayers();
      const data = await fetchLayerFeatures(
        apiBase,
        layerId,
        bbox,
        filters,
        signal,
        spec.contractVersion
      );
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
      if (map.getLayer(clusterId)) map.setPaintProperty(clusterId, "circle-opacity", next);
      if (map.getLayer(countId)) map.setPaintProperty(countId, "text-opacity", next);
      if (map.getLayer(pinLayerId)) {
        map.setPaintProperty(pinLayerId, "icon-opacity", 0.92 * next);
      }
      if (map.getLayer(labelId)) map.setPaintProperty(labelId, "text-opacity", next);
    },
    detach() {
      unregisterInteractivePins(map, [pinLayerId, labelId]);
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
