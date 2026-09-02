import type maplibregl from "maplibre-gl";
import type { Bbox, FilterValues, FeatureCollection } from "@mapos/layer-sdk";
import { fetchLayerFeatures } from "../engine/LayerEngine";
import { ensurePinImages } from "../map/pinIcons";

const iconImageExpr: maplibregl.ExpressionSpecification = [
  "coalesce",
  ["image", ["concat", "pin-", ["get", "category"]]],
  ["image", "pin-default"]
];

export type PinsLayerLoader = (
  bbox: Bbox,
  filters: FilterValues,
  signal?: AbortSignal
) => Promise<FeatureCollection>;

export interface PinsLayerOptions {
  /** Personal pins are intentionally a little easier to spot than catalogue results. */
  personal?: boolean;
}

export function pinIconSizeExpression(personal: boolean): maplibregl.ExpressionSpecification {
  return personal
    ? ["interpolate", ["linear"], ["zoom"], 5, 0.42, 8, 0.55, 12, 0.66, 16, 0.8]
    : ["interpolate", ["linear"], ["zoom"], 5, 0.35, 8, 0.48, 12, 0.58, 16, 0.7];
}

export function createPinsLayerHandle(
  map: maplibregl.Map,
  apiBase: string,
  layerId: string,
  color: string,
  loader: PinsLayerLoader = (bbox, filters, signal) =>
    fetchLayerFeatures(apiBase, layerId, bbox, filters, signal),
  options: PinsLayerOptions = {}
) {
  const sourceId = `source-${layerId}`;
  const clusterLayerId = `pins-${layerId}-cluster`;
  const clusterCountId = `pins-${layerId}-cluster-count`;
  const pinLayerId = `pins-${layerId}-pin`;
  const pinLabelId = `pins-${layerId}-label`;

  function ensureLayers() {
    ensurePinImages(map);
    if (map.getSource(sourceId)) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      // Above z5 the whole view (even the entire Czech Republic) shows individual pins —
      // clustering is only useful for the very zoomed-out overview.
      clusterMaxZoom: 5,
      clusterRadius: 42
    });

    map.addLayer({
      id: clusterLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": color,
        "circle-radius": ["step", ["get", "point_count"], 16, 8, 22, 25, 28],
        "circle-opacity": 0.92,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    });
    map.addLayer({
      id: clusterCountId,
      type: "symbol",
      source: sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": 12,
        "text-font": ["Noto Sans Regular"]
      },
      paint: { "text-color": "#ffffff" }
    });
    map.addLayer({
      id: pinLayerId,
      type: "symbol",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": iconImageExpr,
        "icon-size": pinIconSizeExpression(Boolean(options.personal)),
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
      }
    });
    map.addLayer({
      id: pinLabelId,
      type: "symbol",
      source: sourceId,
      minzoom: 13,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 0.35],
        "text-anchor": "top",
        "text-max-width": 10,
        "text-font": ["Noto Sans Regular"]
      },
      paint: {
        "text-color": "#1C1917",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4
      }
    });
  }

  const layerIds = [clusterLayerId, clusterCountId, pinLayerId, pinLabelId];

  function setData(data: FeatureCollection) {
    ensureLayers();
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
  }

  return {
    async update(
      bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      ensureLayers();
      const data = await loader(bbox, filters, signal);
      setData(data);
      return data;
    },
    setData,
    setVisible(visible: boolean) {
      ensureLayers();
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    },
    setOpacity(opacity: number) {
      ensureLayers();
      if (map.getLayer(clusterLayerId))
        map.setPaintProperty(clusterLayerId, "circle-opacity", opacity * 0.92);
      if (map.getLayer(pinLayerId)) map.setPaintProperty(pinLayerId, "icon-opacity", opacity);
    },
    detach() {
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
