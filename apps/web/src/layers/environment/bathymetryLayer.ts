import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

interface BathymetryGrid {
  bbox: Bbox;
  cols: number;
  rows: number;
  values: (number | null)[];
}

function dimensions(zoom: number): { cols: number; rows: number } {
  if (zoom < 7) return { cols: 4, rows: 3 };
  if (zoom < 10) return { cols: 6, rows: 4 };
  return { cols: 8, rows: 6 };
}

function mix(a: number, b: number, amount: number): number {
  return Math.round(a + (b - a) * amount);
}

function colorAt(depth: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [177, 239, 232]],
    [100, [83, 193, 214]],
    [500, [32, 119, 173]],
    [2_000, [23, 60, 115]],
    [6_000, [8, 22, 54]]
  ];
  const value = Math.max(0, Math.min(6_000, depth));
  for (let index = 1; index < stops.length; index += 1) {
    const [end, endRgb] = stops[index]!;
    const [start, startRgb] = stops[index - 1]!;
    if (value > end) continue;
    const amount = (value - start) / (end - start);
    return `rgb(${mix(startRgb[0], endRgb[0], amount)}, ${mix(startRgb[1], endRgb[1], amount)}, ${mix(startRgb[2], endRgb[2], amount)})`;
  }
  return "rgb(8, 22, 54)";
}

function features(grid: BathymetryGrid): FeatureCollection {
  const [west, south, east, north] = grid.bbox;
  const lngStep = (east - west) / grid.cols;
  const latStep = (north - south) / grid.rows;
  return {
    type: "FeatureCollection",
    features: grid.values.flatMap((value, index) => {
      if (value === null || !Number.isFinite(value)) return [];
      const row = Math.floor(index / grid.cols);
      const col = index % grid.cols;
      const left = west + col * lngStep;
      const right = left + lngStep;
      const top = north - row * latStep;
      const bottom = top - latStep;
      const ring: [number, number][] = [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top]
      ];
      return [
        {
          type: "Feature",
          id: `depth-${row}-${col}`,
          geometry: {
            type: "Polygon",
            coordinates: [ring]
          },
          properties: {
            depth: value,
            label: `−${Math.round(value).toLocaleString("cs-CZ")} m`,
            color: colorAt(value)
          }
        }
      ];
    })
  } as unknown as FeatureCollection;
}

/** Numeric EMODnet cells. The WMS remains the authoritative source; this compact adapter adds
 * labels and zoom-aware cells so users can read the median depth instead of guessing from a
 * basemap's contour tint. */
export function createBathymetryLayerHandle(
  map: maplibregl.Map,
  apiBase: string,
  layerId: string
): LayerHandle {
  const sourceId = `source-${layerId}-grid`;
  const fillId = `fill-${layerId}-grid`;
  const lineId = `line-${layerId}-grid`;
  const labelId = `label-${layerId}-grid`;
  let visible = true;
  let opacity = 0.72;
  const responseCache = new Map<string, FeatureCollection>();

  function ensureLayers(): void {
    if (map.getSource(sourceId)) return;
    map.addSource(sourceId, {
      type: "geojson",
      promoteId: "id",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer({
      id: fillId,
      type: "fill",
      source: sourceId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "fill-color": ["get", "color"], "fill-opacity": opacity }
    });
    map.addLayer({
      id: lineId,
      type: "line",
      source: sourceId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "line-color": "rgba(255,255,255,.28)", "line-width": 0.6, "line-opacity": opacity }
    });
    map.addLayer({
      id: labelId,
      type: "symbol",
      source: sourceId,
      minzoom: 6,
      layout: {
        visibility: visible ? "visible" : "none",
        "text-field": ["get", "label"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 12, 12],
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false
      },
      paint: {
        "text-color": "#fff",
        "text-halo-color": "rgba(8,22,54,.85)",
        "text-halo-width": 1.2
      }
    });
  }

  const setVisibility = (id: string, next: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
  };

  return {
    async update(bbox: Bbox, _filters: FilterValues, signal?: AbortSignal) {
      ensureLayers();
      const dims = dimensions(map.getZoom());
      const roundedBbox = bbox.map((value) => Math.round(value * 100) / 100) as Bbox;
      const cacheKey = `${roundedBbox.join(",")}:${dims.cols}x${dims.rows}`;
      const cached = responseCache.get(cacheKey);
      if (cached) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(cached);
        return null;
      }
      const params = new URLSearchParams({
        bbox: roundedBbox.join(","),
        cols: String(dims.cols),
        rows: String(dims.rows)
      });
      const response = await fetch(`${apiBase}/environment/bathymetry/grid?${params}`, { signal });
      if (!response.ok) throw new Error(`Bathymetry grid unavailable (${response.status})`);
      const grid = (await response.json()) as BathymetryGrid;
      const rendered = features(grid);
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(rendered);
      responseCache.set(cacheKey, rendered);
      while (responseCache.size > 6) responseCache.delete(responseCache.keys().next().value!);
      return null;
    },
    setData(_data) {
      ensureLayers();
    },
    setVisible(next: boolean) {
      visible = next;
      ensureLayers();
      [fillId, lineId, labelId].forEach((id) => setVisibility(id, next));
    },
    setOpacity(next: number) {
      opacity = next;
      ensureLayers();
      if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-opacity", opacity);
      if (map.getLayer(lineId)) map.setPaintProperty(lineId, "line-opacity", opacity);
    },
    detach() {
      [labelId, lineId, fillId].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      responseCache.clear();
    }
  };
}
