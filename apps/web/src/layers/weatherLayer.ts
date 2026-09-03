import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues } from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { emit } from "../lib/events";
import { createAdaptiveWeatherOverlay } from "./weather/adaptiveOverlay";
import { WEATHER_RUNTIME_BUDGET, weatherUpdatePlan } from "./weather/strategy";
import { createWindParticles } from "./weather/windParticles";
import type { WeatherGrid, WeatherVariableId } from "./weather/grid";
import { browserProviderBackoff, browserProviderHealth } from "../tasks/BrowserProviderHealth";

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

/** RainViewer's own palettes, exposed so the radar can be as saturated as the rest of the
 *  overlays instead of the muted default. 7 = "Rainbow SELEX-SI", the most legible of the set. */
const RADAR_COLOR_SCHEME = 7;

let liveRadarPathCache: { path: string | null; expiresAt: number } | null = null;

function cacheLiveRadarMiss(): void {
  liveRadarPathCache = {
    path: null,
    expiresAt: Date.now() + WEATHER_RUNTIME_BUDGET.liveRadarNegativeTtlMs
  };
}

export function __resetLiveRadarPathCacheForTests(): void {
  liveRadarPathCache = null;
}

export async function loadLiveRadarPath(signal?: AbortSignal): Promise<string | null> {
  if (liveRadarPathCache && liveRadarPathCache.expiresAt > Date.now()) {
    return liveRadarPathCache.path;
  }
  if (!browserProviderBackoff.tryAcquire("rainviewer-browser")) {
    cacheLiveRadarMiss();
    browserProviderHealth.record({
      providerId: "rainviewer-browser",
      outcome: "circuit-open",
      durationMs: 0
    });
    return null;
  }
  const startedAt = performance.now();
  try {
    const res = await fetch(RAINVIEWER_API, { signal });
    if (!res.ok) {
      cacheLiveRadarMiss();
      browserProviderBackoff.failure("rainviewer-browser");
      browserProviderHealth.record({
        providerId: "rainviewer-browser",
        outcome: "error",
        durationMs: performance.now() - startedAt
      });
      return null;
    }
    const data = (await res.json()) as { radar?: { past?: Array<{ path: string }> } };
    const past = data.radar?.past;
    const path = past?.length ? past[past.length - 1]!.path : null;
    liveRadarPathCache = {
      path,
      expiresAt: Date.now() + WEATHER_RUNTIME_BUDGET.liveRadarMetadataTtlMs
    };
    browserProviderBackoff.success("rainviewer-browser");
    browserProviderHealth.record({
      providerId: "rainviewer-browser",
      outcome: "success",
      durationMs: performance.now() - startedAt
    });
    return path;
  } catch {
    if (signal?.aborted) browserProviderBackoff.aborted("rainviewer-browser");
    else {
      cacheLiveRadarMiss();
      browserProviderBackoff.failure("rainviewer-browser");
    }
    browserProviderHealth.record({
      providerId: "rainviewer-browser",
      outcome: signal?.aborted ? "aborted" : "error",
      durationMs: performance.now() - startedAt
    });
    return null;
  }
}

async function loadGrid(
  bbox: Bbox,
  variable: WeatherVariableId,
  at: string | null,
  cols: number,
  rows: number,
  signal?: AbortSignal
): Promise<WeatherGrid | null> {
  try {
    const res = await fetch(
      `${API_BASE}/weather/grid?bbox=${bbox.map((n) => n.toFixed(3)).join(",")}` +
        `&variable=${variable}&cols=${cols}&rows=${rows}` +
        `${at ? `&at=${encodeURIComponent(at)}` : ""}`,
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

  const field = createAdaptiveWeatherOverlay(map, layerId, { beforeId: radarLayerId });
  const wind = createWindParticles(map);

  let currentRadarUrl = "";
  let radarActive = false;
  let visible = true;
  let baseOpacity = 0.6;
  let pendingLiveRadarTileStartedAt: number | null = null;
  /** Guards against a slow metadata/grid response landing after the user switched variables. */
  let updateRequestId = 0;

  const recordLiveRadarTile = (outcome: "success" | "error" | "aborted") => {
    const startedAt = pendingLiveRadarTileStartedAt;
    if (startedAt === null && outcome !== "error") return;
    browserProviderHealth.record({
      providerId: "rainviewer-browser",
      outcome,
      durationMs: startedAt === null ? 0 : performance.now() - startedAt
    });
    pendingLiveRadarTileStartedAt = null;
  };

  const onRadarSourceData = (event: maplibregl.MapSourceDataEvent) => {
    if (
      event.sourceId === radarSourceId &&
      event.isSourceLoaded &&
      currentRadarUrl.startsWith("https://tilecache.rainviewer.com")
    ) {
      recordLiveRadarTile("success");
    }
  };

  const onRadarError = (event: maplibregl.ErrorEvent) => {
    const sourceId = (event as maplibregl.ErrorEvent & { sourceId?: unknown }).sourceId;
    if (
      sourceId === radarSourceId &&
      currentRadarUrl.startsWith("https://tilecache.rainviewer.com")
    ) {
      recordLiveRadarTile("error");
    }
  };

  map.on("sourcedata", onRadarSourceData);
  map.on("error", onRadarError);

  function ensureRadarLayer(tileUrl: string | null) {
    if (!tileUrl) {
      recordLiveRadarTile("aborted");
      radarActive = false;
      if (map.getLayer(radarLayerId)) {
        map.setLayoutProperty(radarLayerId, "visibility", "none");
      }
      return;
    }

    radarActive = true;
    if (tileUrl !== currentRadarUrl) {
      recordLiveRadarTile("aborted");
      pendingLiveRadarTileStartedAt = tileUrl.startsWith("https://tilecache.rainviewer.com")
        ? performance.now()
        : null;
    }
    const existing = map.getSource(radarSourceId) as maplibregl.RasterTileSource | undefined;
    if (existing) {
      if (tileUrl !== currentRadarUrl) existing.setTiles([tileUrl]);
    } else {
      // Archived frames only go up to z5 (see radarArchiver) — overzoom keeps close-up views
      // working without fetching a separate high-resolution tile pyramid.
      map.addSource(radarSourceId, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: WEATHER_RUNTIME_BUDGET.radarTileMaxZoom
      });
    }
    if (!map.getLayer(radarLayerId)) {
      map.addLayer({
        id: radarLayerId,
        type: "raster",
        source: radarSourceId,
        paint: { "raster-opacity": baseOpacity, "raster-fade-duration": 120 },
        layout: { visibility: visible ? "visible" : "none" }
      });
    } else {
      map.setLayoutProperty(radarLayerId, "visibility", visible ? "visible" : "none");
    }
    currentRadarUrl = tileUrl;
  }

  return {
    async update(
      bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      const requestId = ++updateRequestId;
      const frameTs = typeof filters.frameTs === "number" ? filters.frameTs : null;
      const at = typeof filters.at === "string" ? filters.at : null;
      const canvas = map.getCanvas();
      const plan = weatherUpdatePlan({
        active: true,
        filters,
        zoom: map.getZoom(),
        viewportWidth: canvas.clientWidth || canvas.width || 1,
        viewportHeight: canvas.clientHeight || canvas.height || 1,
        bbox
      });

      if (plan.kind === "radar") {
        field.clear();
        wind.setGrid(null);
        const radarTileUrl = frameTs
          ? `${API_BASE}/weather/radar/${frameTs}/{z}/{x}/{y}.png`
          : await (async () => {
              const path = await loadLiveRadarPath(signal);
              return path
                ? `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/1_1.png`
                : null;
            })();
        if (requestId !== updateRequestId || signal?.aborted) return null;
        ensureRadarLayer(radarTileUrl);
        return null;
      }

      ensureRadarLayer(null);
      field.setValueLabels(filters.valueLabels !== false);
      if (plan.kind !== "grid") {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      const grid = await loadGrid(
        bbox,
        plan.variable,
        at,
        plan.strategy.cols,
        plan.strategy.rows,
        signal
      );
      if (requestId !== updateRequestId || signal?.aborted) return null;

      if (!grid) {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      const renderedCount = field.render(grid, plan.strategy);
      // Flow is useful at regional scale, but local numeric sectors take priority over motion.
      wind.setGrid(plan.animateWind && grid.u && grid.v ? grid : null);
      emit("weather-grid-updated", {
        variable: grid.variable,
        unit: grid.unit,
        median: grid.median,
        min: grid.min,
        max: grid.max,
        sampleCount: grid.sampleCount,
        validAt: grid.validAt,
        representation: plan.strategy.representation,
        renderedCount,
        targetCellAreaKm2: plan.strategy.targetCellAreaKm2
      });
      return null;
    },
    setVisible(nextVisible: boolean) {
      visible = nextVisible;
      const vis = nextVisible ? "visible" : "none";
      if (map.getLayer(radarLayerId)) {
        map.setLayoutProperty(radarLayerId, "visibility", radarActive ? vis : "none");
      }
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
      recordLiveRadarTile("aborted");
      map.off("sourcedata", onRadarSourceData);
      map.off("error", onRadarError);
      if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId);
      if (map.getSource(radarSourceId)) map.removeSource(radarSourceId);
      field.detach();
      wind.detach();
      currentRadarUrl = "";
      radarActive = false;
    }
  };
}
