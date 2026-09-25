import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues } from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { getMapStore } from "../store/mapStore";
import { emit } from "../lib/events";
import { createAdaptiveWeatherOverlay } from "./weather/adaptiveOverlay";
import { WEATHER_RUNTIME_BUDGET, weatherUpdatePlan } from "./weather/strategy";
import { createWindParticles } from "./weather/windParticles";
import type { WeatherGrid, WeatherVariableId } from "./weather/grid";
import {
  resolveWeatherModel,
  resolveWeatherVisualization,
  type WeatherModelId
} from "./weather/controls";
import { mapTilerFrameFor } from "./weather/maptiler";
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

export async function loadGrid(
  bbox: Bbox,
  variable: WeatherVariableId,
  at: string | null,
  cols: number,
  rows: number,
  model: WeatherModelId,
  signal?: AbortSignal
): Promise<WeatherGrid | null> {
  const res = await fetch(
    `${API_BASE}/weather/grid?bbox=${bbox.map((n) => n.toFixed(3)).join(",")}` +
      `&variable=${variable}&cols=${cols}&rows=${rows}&model=${model}` +
      `${at ? `&at=${encodeURIComponent(at)}` : ""}`,
    { signal }
  );
  if (!res.ok)
    throw new Error(`Počasí se nepodařilo načíst (${res.status}). Zkuste obnovit vrstvu.`);
  const grid = (await res.json()) as WeatherGrid;
  if (
    !Array.isArray(grid.values) ||
    grid.values.length !== grid.cols * grid.rows ||
    grid.sampleCount < 1
  )
    throw new Error("Pro tento výřez nebo model nejsou dostupné údaje o počasí.");
  return grid;
}

export function createWeatherLayerHandle(map: maplibregl.Map, layerId: string) {
  const radarSourceId = `source-${layerId}-radar`;
  const radarLayerId = `raster-${layerId}-radar`;

  const field = createAdaptiveWeatherOverlay(map, layerId, { beforeId: radarLayerId });
  const wind = createWindParticles(map);

  let currentRadarUrl = "";
  let currentTileSize = 256;
  let currentMaxzoom: number = WEATHER_RUNTIME_BUDGET.radarTileMaxZoom;
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

  function ensureRasterLayer(
    tileUrl: string | null,
    options: { tileSize: number; maxzoom: number; live: boolean }
  ) {
    if (!tileUrl) {
      if (options.live) recordLiveRadarTile("aborted");
      radarActive = false;
      if (map.getLayer(radarLayerId)) {
        map.setLayoutProperty(radarLayerId, "visibility", "none");
      }
      return;
    }

    radarActive = true;
    const live = options.live && tileUrl.startsWith("https://tilecache.rainviewer.com");
    if (tileUrl !== currentRadarUrl) {
      if (options.live) recordLiveRadarTile("aborted");
      pendingLiveRadarTileStartedAt = live ? performance.now() : null;
    }
    // A raster source's tileSize/maxzoom are fixed once added, so a provider switch that changes
    // the tile shape (RainViewer 256 px vs MapTiler 512 px) has to rebuild the source.
    if (
      map.getSource(radarSourceId) &&
      (currentTileSize !== options.tileSize || currentMaxzoom !== options.maxzoom)
    ) {
      if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId);
      map.removeSource(radarSourceId);
    }
    const existing = map.getSource(radarSourceId) as maplibregl.RasterTileSource | undefined;
    if (existing) {
      if (tileUrl !== currentRadarUrl) existing.setTiles([tileUrl]);
    } else {
      // RainViewer's archived frames only go up to z5 (see radarArchiver); MapTiler stops at z3.
      // Overzoom keeps close-up views working without fetching a pyramid that does not exist.
      map.addSource(radarSourceId, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: options.tileSize,
        maxzoom: options.maxzoom
      });
      currentTileSize = options.tileSize;
      currentMaxzoom = options.maxzoom;
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

      // MapTiler weather: pre-rendered animated tiles instead of a numeric grid. The frame
      // follows the timeline cursor, so the shared scrubber still drives it.
      const autoTiles =
        !filters.provider &&
        resolveWeatherModel(filters.model) === "best_match" &&
        map.getZoom() < 6.5 &&
        Boolean(getMapStore().capabilities?.maptiler);
      let tiledField = false;
      if (
        filters.provider === "maptiler" ||
        (autoTiles && resolveWeatherVisualization(filters) !== "radar")
      ) {
        const frame = await mapTilerFrameFor(resolveWeatherVisualization(filters), at, signal);
        if (requestId !== updateRequestId || signal?.aborted) return null;
        if (frame) {
          field.clear();
          ensureRasterLayer(frame.template, {
            tileSize: frame.tileSize,
            maxzoom: frame.maxzoom,
            live: false
          });
          tiledField = true;
          if (resolveWeatherVisualization(filters) !== "wind") {
            wind.setGrid(null);
            return null;
          }
        }
        // Unsupported or unavailable tiles fall through to the numeric forecast. Wind also
        // loads its vector field so tile colours never disable the animated flow.
      }

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
        ensureRasterLayer(radarTileUrl, {
          tileSize: 256,
          maxzoom: WEATHER_RUNTIME_BUDGET.radarTileMaxZoom,
          live: true
        });
        return null;
      }

      if (!tiledField)
        ensureRasterLayer(null, {
          tileSize: 256,
          maxzoom: WEATHER_RUNTIME_BUDGET.radarTileMaxZoom,
          live: false
        });
      field.setValueLabels(filters.valueLabels !== false);
      if (plan.kind !== "grid") {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      // Keep the previous field visible until the single bounded replacement is ready.
      // A second coarse request doubles provider work and delays the final grid.
      const grid = await loadGrid(
        bbox,
        plan.variable,
        at,
        plan.strategy.cols,
        plan.strategy.rows,
        resolveWeatherModel(filters.model),
        signal
      );
      if (requestId !== updateRequestId || signal?.aborted) return null;

      if (!grid) {
        field.clear();
        wind.setGrid(null);
        return null;
      }

      const renderedCount = tiledField ? 1 : field.render(grid, plan.strategy);
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
      updateRequestId++;
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
