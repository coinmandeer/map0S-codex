import { registerInteractivePins, unregisterInteractivePins } from "../map/interactivePins";
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
    ? ["interpolate", ["linear"], ["zoom"], 5, 0.7, 8, 0.75, 12, 0.83, 16, 0.87]
    : ["interpolate", ["linear"], ["zoom"], 5, 0.65, 8, 0.7, 12, 0.78, 16, 0.86];
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

  let currentVisible = true;
  let currentOpacity = 1;

  function ensureLines() {
    if (map.getSource(lineSourceId)) return;
    // Routes need a source of their own: clustering runs the data through a point index, so a
    // LineString added to the clustered source below would simply never appear.
    map.addSource(lineSourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer(
      {
        id: lineLayerId,
        type: "line",
        source: lineSourceId,
        layout: {
          "line-join": "round",
          "line-cap": "round",
          visibility: currentVisible ? "visible" : "none"
        },
        paint: {
          "line-color": ["coalesce", ["get", "color"], color],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 12, 3.5, 16, 5],
          "line-opacity": 0.9 * currentOpacity
        }
      },
      map.getLayer(clusterLayerId) ? clusterLayerId : undefined
    );
  }

  function ensureLayers() {
    ensurePinImages(map);
    registerInteractivePins(map, layerId, [pinLayerId, pinLabelId]);
    if (map.getSource(sourceId)) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      // Stable ids let the map highlight one hovered pin with feature-state.  The alternative
      // (DOM markers) scales with every feature and was the reason dense views felt heavy.
      promoteId: "id",
      cluster: true,
      // Group regional views; city views expose individual places from zoom 12.
      clusterMaxZoom: 11,
      clusterRadius: 36
    });

    map.addLayer({
      id: clusterLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": color,
        "circle-radius": ["step", ["get", "point_count"], 16, 8, 19, 25, 22, 100, 24],
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
        "text-size": 13,
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
        "icon-anchor": "center",
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
    if (lines.length) {
      ensureLines();
      (map.getSource(lineSourceId) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: lines
      });
    } else {
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getSource(lineSourceId)) map.removeSource(lineSourceId);
    }
  }

  return {
    async update(
      bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      ensureLayers();
      const data = await loader(bbox, filters, signal);
      return data;
    },
    setData,
    setVisible(visible: boolean) {
      currentVisible = visible;
      ensureLayers();
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    },
    setOpacity(opacity: number) {
      currentOpacity = opacity;
      ensureLayers();
      if (map.getLayer(clusterLayerId))
        map.setPaintProperty(clusterLayerId, "circle-opacity", opacity * 0.92);
      if (map.getLayer(pinLayerId)) map.setPaintProperty(pinLayerId, "icon-opacity", opacity);
      if (map.getLayer(lineLayerId))
        map.setPaintProperty(lineLayerId, "line-opacity", opacity * 0.9);
    },
    detach() {
      unregisterInteractivePins(map, [pinLayerId, pinLabelId]);
      for (const id of [...layerIds].reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getSource(lineSourceId)) map.removeSource(lineSourceId);
    }
  };
}
