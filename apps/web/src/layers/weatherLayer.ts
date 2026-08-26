import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues } from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { createGridOverlay } from "./weather/gridOverlay";
import { createWindParticles } from "./weather/windParticles";
import type { WeatherGrid, WeatherVariableId } from "./weather/grid";

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

/** RainViewer's own palettes, exposed so the radar can be as saturated as the rest of the
 *  overlays instead of the muted default. 7 = "Rainbow SELEX-SI", the most legible of the set. */
const RADAR_COLOR_SCHEME = 7;

async function loadLiveRadarPath(): Promise<string | null> {
  try {
    const res = await fetch(RAINVIEWER_API);
    const data = (await res.json()) as { radar?: { past?: Array<{ path: string }> } };
    const past = data.radar?.past;
    if (!past?.length) return null;
    return past[past.length - 1]!.path;
  } catch {
    return null;
  }
}

async function loadGrid(
  bbox: Bbox,
  variable: WeatherVariableId,
  signal?: AbortSignal
): Promise<WeatherGrid | null> {
  try {
    const res = await fetch(
      `${API_BASE}/weather/grid?bbox=${bbox.map((n) => n.toFixed(3)).join(",")}&variable=${variable}`,
      { signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as WeatherGrid;
  } catch {
    return null;
  }
}

export function createWeatherLayerHandle(map: maplibregl.Map, layerId: string) {
  const radarSourceId = `source-${layerId}-radar`;
  const radarLayerId = `raster-${layerId}-radar`;

  const field = createGridOverlay(map, layerId, { beforeId: radarLayerId });
  const wind = createWindParticles(map);

  let currentRadarUrl = "";
  let visible = true;
  let baseOpacity = 0.6;
  /** Guards against a slow grid response landing after the user switched variables. */
  let gridRequestId = 0;

  function ensureRadarLayer(tileUrl: string | null) {
    if (!tileUrl) {
      if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId);
      if (map.getSource(radarSourceId)) map.removeSource(radarSourceId);
      currentRadarUrl = "";
      return;
    }
    if (tileUrl === currentRadarUrl && map.getSource(radarSourceId)) return;
    if (map.getSource(radarSourceId)) {
      if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId);
      map.removeSource(radarSourceId);
    }
    // Archived frames only go up to z5 (see radarArchiver) — overzoom keeps close-up views
    // working (blurrier, but radar data is inherently coarse) while avoiding fetching a
    // separate high-res tile set per zoom level, which matters on limited mobile data plans.
    map.addSource(radarSourceId, { type: "raster", tiles: [tileUrl], tileSize: 256, maxzoom: 5 });
    map.addLayer({
      id: radarLayerId,
      type: "raster",
      source: radarSourceId,
      paint: { "raster-opacity": baseOpacity, "raster-fade-duration": 250 },
      layout: { visibility: visible ? "visible" : "none" }
    });
    currentRadarUrl = tileUrl;
  }

  return {
    async update(
      bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      const frameTs = typeof filters.frameTs === "number" ? filters.frameTs : null;
      const radarEnabled = filters.radar !== false;
      const variable =
        typeof filters.variable === "string" ? (filters.variable as WeatherVariableId) : null;

      const radarTileUrl = !radarEnabled
        ? null
        : frameTs
          ? `${API_BASE}/weather/radar/${frameTs}/{z}/{x}/{y}.png`
          : await (async () => {
              const path = await loadLiveRadarPath();
              return path
                ? `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/1_1.png`
                : null;
            })();
      ensureRadarLayer(radarTileUrl);

      const requestId = ++gridRequestId;
      if (!variable) {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      const grid = await loadGrid(bbox, variable, signal);
      if (requestId !== gridRequestId) return null;

      if (!grid) {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      field.render(grid);
      // Only the wind field carries the u/v components the particles need.
      wind.setGrid(grid.u && grid.v ? grid : null);
      return null;
    },
    setVisible(nextVisible: boolean) {
      visible = nextVisible;
      const vis = nextVisible ? "visible" : "none";
      if (map.getLayer(radarLayerId)) map.setLayoutProperty(radarLayerId, "visibility", vis);
      field.setVisible(nextVisible);
      wind.setVisible(nextVisible);
    },
    setOpacity(opacity: number) {
      baseOpacity = opacity;
      if (map.getLayer(radarLayerId)) map.setPaintProperty(radarLayerId, "raster-opacity", opacity);
      field.setOpacity(Math.min(1, opacity + 0.15));
      wind.setOpacity(opacity);
    },
    detach() {
      if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId);
      if (map.getSource(radarSourceId)) map.removeSource(radarSourceId);
      field.detach();
      wind.detach();
      currentRadarUrl = "";
    }
  };
}
