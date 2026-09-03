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
  const lineSourceId = `source-${layerId}-lines`;
  const clusterLayerId = `pins-${layerId}-cluster`;
  const clusterCountId = `pins-${layerId}-cluster-count`;
  const pinLayerId = `pins-${layerId}-pin`;
  const pinLabelId = `pins-${layerId}-label`;
  const lineLayerId = `pins-${layerId}-line`;

  function ensureLayers() {
    ensurePinImages(map);
    if (map.getSource(sourceId)) return;

    // Routes need a source of their own: clustering runs the data through a point index, so a
    // LineString added to the clustered source below would simply never appear.
    map.addSource(lineSourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer({
      id: lineLayerId,
      type: "line",
      source: lineSourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "color"], color],
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 12, 3.5, 16, 5],
        "line-opacity": 0.9
      }
    });

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

  const layerIds = [lineLayerId, clusterLayerId, clusterCountId, pinLayerId, pinLabelId];

  function setData(data: FeatureCollection) {
    ensureLayers();
    const lines: FeatureCollection["features"] = [];
    const points: FeatureCollection["features"] = [];
    for (const feature of data.features) {
      if (feature.geometry.type === "LineString") {
        lines.push(feature);
        // A route also gets a pin at its anchor, so it stays clickable, labelled and listed
        // alongside every other place rather than becoming a line you cannot select.
        const anchorLng = Number(feature.properties?.anchorLng);
        const anchorLat = Number(feature.properties?.anchorLat);
        if (Number.isFinite(anchorLng) && Number.isFinite(anchorLat)) {
          points.push({
            ...feature,
            geometry: { type: "Point", coordinates: [anchorLng, anchorLat] }
          });
        }
      } else points.push(feature);
    }
    (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: points
    });
    (map.getSource(lineSourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lines
    });
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
      if (map.getLayer(lineLayerId))
        map.setPaintProperty(lineLayerId, "line-opacity", opacity * 0.9);
    },
    detach() {
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getSource(lineSourceId)) map.removeSource(lineSourceId);
    }
  };
}
