import type maplibregl from "maplibre-gl";
import { emit } from "../../lib/events";
import { createGridOverlay } from "./gridOverlay";
import type { WeatherGrid } from "./grid";
import { paletteFor, sampleRamp } from "./palettes";
import type { WeatherRepresentation, WeatherZoomStrategy } from "./strategy";

type Position = [number, number];

export interface WeatherRenderFeature {
  type: "Feature";
  id: string;
  geometry:
    { type: "Polygon"; coordinates: Position[][] } | { type: "Point"; coordinates: Position };
  properties: {
    kind: "sector" | "label";
    variable: string;
    variableLabel: string;
    value: number;
    label: string;
    unit: string;
    validAt: string;
    color: string;
  };
}

export interface WeatherRenderFeatureCollection {
  type: "FeatureCollection";
  features: WeatherRenderFeature[];
}

function selectedIndices(total: number, limit: number): number[] {
  if (limit <= 0 || total <= 0) return [];
  if (total <= limit) return Array.from({ length: total }, (_, index) => index);
  const stride = Math.ceil(total / limit);
  return Array.from({ length: total }, (_, index) => index).filter((index) => index % stride === 0);
}

function labelFor(value: number, unit: string): string {
  const digits = Math.abs(value) < 10 && unit !== "%" ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

function sectorGeometry(grid: WeatherGrid, index: number) {
  const [west, south, east, north] = grid.bbox;
  const row = Math.floor(index / grid.cols);
  const col = index % grid.cols;
  const lngStep = (east - west) / Math.max(1, grid.cols - 1);
  const latStep = (north - south) / Math.max(1, grid.rows - 1);
  const lng = west + col * lngStep;
  const lat = north - row * latStep;
  const left = col === 0 ? west : lng - lngStep / 2;
  const right = col === grid.cols - 1 ? east : lng + lngStep / 2;
  const top = row === 0 ? north : lat + latStep / 2;
  const bottom = row === grid.rows - 1 ? south : lat - latStep / 2;
  return {
    center: [lng, lat] as Position,
    polygon: [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top]
    ] as Position[]
  };
}

/** Converts a provider grid into bounded MapLibre-native features. Numeric values are one symbol
 * layer, never a collection of DOM markers. */
export function weatherGridFeatures(
  grid: WeatherGrid,
  strategy: Pick<WeatherZoomStrategy, "representation" | "maxRenderedCells" | "maxNumericLabels">
): WeatherRenderFeatureCollection {
  if (strategy.representation === "continuous-grid") {
    return { type: "FeatureCollection", features: [] };
  }

  const palette = paletteFor(grid.variable);
  const valid = grid.values.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  const sectorSelection = new Set(
    selectedIndices(valid.length, strategy.maxRenderedCells).map((index) => valid[index]!.index)
  );
  const labelSelection = new Set(
    selectedIndices(valid.length, strategy.maxNumericLabels).map((index) => valid[index]!.index)
  );
  const features: WeatherRenderFeature[] = [];

  for (const { index, value } of valid) {
    const geometry = sectorGeometry(grid, index);
    const [r, g, b, a] = sampleRamp(palette, value);
    const properties = {
      variable: grid.variable,
      variableLabel: grid.label,
      value,
      label: labelFor(value, grid.unit),
      unit: grid.unit,
      validAt: grid.validAt,
      color: `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
    };
    if (sectorSelection.has(index)) {
      features.push({
        type: "Feature",
        id: `sector-${index}`,
        geometry: { type: "Polygon", coordinates: [geometry.polygon] },
        properties: { ...properties, kind: "sector" }
      });
    }
    if (strategy.representation === "numeric-sectors" && labelSelection.has(index)) {
      features.push({
        type: "Feature",
        id: `label-${index}`,
        geometry: { type: "Point", coordinates: geometry.center },
        properties: { ...properties, kind: "label" }
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export interface AdaptiveWeatherOverlay {
  render(grid: WeatherGrid, strategy: WeatherZoomStrategy): number;
  clear(): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  /** Numbers printed in the sectors once zoomed in. Users reading the coloured field as a
   *  picture find them noisy, so the layers drawer can turn them off (§4.7 ⑤). */
  setValueLabels(enabled: boolean): void;
  detach(): void;
}

export function createAdaptiveWeatherOverlay(
  map: maplibregl.Map,
  layerId: string,
  options: { beforeId?: string } = {}
): AdaptiveWeatherOverlay {
  const continuous = createGridOverlay(map, layerId, options);
  const sourceId = `source-${layerId}-sectors`;
  const fillLayerId = `fill-${layerId}-sectors`;
  const labelLayerId = `symbol-${layerId}-values`;
  let visible = true;
  let opacity = 0.75;
  let valueLabels = true;
  let representation: WeatherRepresentation | null = null;
  let hoverAttached = false;
  let lastHoverId: string | number | null = null;

  const onCellHover = (event: maplibregl.MapLayerMouseEvent) => {
    map.getCanvas().style.cursor = "pointer";
    const feature = event.features?.[0];
    if (!feature?.properties) return;
    const hoverId = feature.id ?? String(feature.properties.label ?? "");
    if (hoverId === lastHoverId) return;
    lastHoverId = hoverId;
    const value = Number(feature.properties.value);
    if (!Number.isFinite(value)) return;
    emit("weather-cell-selected", {
      interaction: "hover",
      variable: String(feature.properties.variable ?? "weather"),
      variableLabel: String(feature.properties.variableLabel ?? "Počasí"),
      value,
      label: String(feature.properties.label ?? `${value}`),
      unit: String(feature.properties.unit ?? ""),
      validAt: String(feature.properties.validAt ?? ""),
      lng: event.lngLat.lng,
      lat: event.lngLat.lat
    });
  };

  const onCellLeave = () => {
    map.getCanvas().style.cursor = "";
    lastHoverId = null;
  };

  const setLayerVisibility = (id: string, next: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
  };

  const labelsVisible = () => visible && valueLabels && representation === "numeric-sectors";

  function ensureVectorLayers(data: WeatherRenderFeatureCollection) {
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data as GeoJSON.FeatureCollection);
    } else {
      map.addSource(sourceId, { type: "geojson", data: data as GeoJSON.FeatureCollection });
    }

    const beforeId =
      options.beforeId && map.getLayer(options.beforeId) ? options.beforeId : undefined;
    if (!map.getLayer(fillLayerId)) {
      map.addLayer(
        {
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          filter: ["==", ["get", "kind"], "sector"],
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": opacity,
            "fill-outline-color": "rgba(255,255,255,0.28)"
          }
        },
        beforeId
      );
    }
    if (!map.getLayer(labelLayerId)) {
      map.addLayer(
        {
          id: labelLayerId,
          type: "symbol",
          source: sourceId,
          filter: ["==", ["get", "kind"], "label"],
          layout: {
            "text-field": ["get", "label"],
            "text-size": 12,
            "text-font": ["Open Sans Semibold"],
            "text-allow-overlap": false,
            "text-padding": 4
          },
          paint: {
            "text-color": "#111827",
            "text-halo-color": "rgba(255,255,255,0.92)",
            "text-halo-width": 1.5,
            "text-opacity": opacity
          }
        },
        beforeId
      );
    }
    if (!hoverAttached) {
      map.on("mousemove", fillLayerId, onCellHover);
      map.on("mouseleave", fillLayerId, onCellLeave);
      hoverAttached = true;
    }
  }

  return {
    render(grid, strategy) {
      representation = strategy.representation;
      if (representation === "continuous-grid") {
        setLayerVisibility(fillLayerId, false);
        setLayerVisibility(labelLayerId, false);
        continuous.render(grid);
        continuous.setVisible(visible);
        return 1;
      }

      continuous.setVisible(false);
      const data = weatherGridFeatures(grid, strategy);
      ensureVectorLayers(data);
      setLayerVisibility(fillLayerId, visible);
      setLayerVisibility(labelLayerId, labelsVisible());
      return data.features.length;
    },
    clear() {
      representation = null;
      continuous.setVisible(false);
      setLayerVisibility(fillLayerId, false);
      setLayerVisibility(labelLayerId, false);
    },
    setVisible(next) {
      visible = next;
      continuous.setVisible(next && representation === "continuous-grid");
      setLayerVisibility(
        fillLayerId,
        next && representation !== null && representation !== "continuous-grid"
      );
      setLayerVisibility(labelLayerId, labelsVisible());
    },
    setOpacity(next) {
      opacity = next;
      continuous.setOpacity(Math.min(1, next + 0.15));
      if (map.getLayer(fillLayerId)) map.setPaintProperty(fillLayerId, "fill-opacity", next);
      if (map.getLayer(labelLayerId)) map.setPaintProperty(labelLayerId, "text-opacity", next);
    },
    setValueLabels(enabled) {
      valueLabels = enabled;
      setLayerVisibility(labelLayerId, labelsVisible());
    },
    detach() {
      if (hoverAttached) {
        map.off("mousemove", fillLayerId, onCellHover);
        map.off("mouseleave", fillLayerId, onCellLeave);
        onCellLeave();
        hoverAttached = false;
      }
      continuous.detach();
      if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
      if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      representation = null;
    }
  };
}
