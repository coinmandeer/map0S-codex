import { useSyncExternalStore } from "react";
import { apiGet } from "../lib/api";
import { emit, on } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { fetchThemeDetail, fetchThemeSummaries } from "../layers/themes/themeCatalog";
import {
  syncThemeLayers,
  themeLayerId,
  type ThemeDetail,
  type ThemeSummary
} from "../layers/themes/themeLayers";

export interface RegionRef {
  code: string;
  level: string;
  name: string;
}
export interface ExplorerRow extends RegionRef {
  value: number | null;
  period: string;
  unit: string;
  source: string;
  sourceUrl: string;
  flag?: string;
}
interface ExplorerState {
  viewportKey?: string;
  catalog: ThemeSummary[];
  details: Record<string, ThemeDetail>;
  activeId: string | null;
  periods: Record<string, string>;
  excluded: Record<string, string[]>;
  regions: RegionRef[];
  returnBbox: [number, number, number, number] | null;
  selected: RegionRef | null;
  open: boolean;
  loading: boolean;
  error: string | null;
}
let state: ExplorerState = {
  catalog: [],
  details: {},
  activeId: null,
  periods: {},
  excluded: {},
  regions: [],
  returnBbox: null,
  selected: null,
  open: false,
  loading: false,
  error: null
};
const listeners = new Set<() => void>();
let request = 0;
let activationController: AbortController | null = null;
let resolutionZoom = 0;
let suspended = false;
let viewport: [number, number, number, number] | null = null;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function update(patch: Partial<ExplorerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export const useStatistics = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
export const statisticsSnapshot = () => state;
function persist() {
  const url = new URL(window.location.href);
  // Explicit share links are consumed; ordinary use does not restore overlays after refresh.
  for (const key of ["stat", "statPaused", "statPeriod", "statExclude", "statRegions"])
    url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}
export function showStatistics(open = true) {
  update({ open });
}
export function returnToStatisticsView() {
  if (state.returnBbox) emit("fit-bounds", { bbox: state.returnBbox });
  update({ returnBbox: null });
}
export function selectStatisticsRegion(region: RegionRef) {
  update({ selected: region, open: true });
}
export function compareStatisticsRegion(region: RegionRef) {
  if (state.regions.some((r) => r.code === region.code && r.level === region.level)) return;
  if (state.regions.length >= 4) {
    getMapStore().showToast("Porovnat lze nejvýše čtyři území.");
    return;
  }
  update({ regions: [...state.regions, region] });
  persist();
}
export function removeStatisticsRegion(code: string, level: string) {
  update({ regions: state.regions.filter((r) => r.code !== code || r.level !== level) });
  persist();
}
export async function activateStatistic(
  id: string,
  period = state.periods[id] ?? "latest",
  excluded = state.excluded[id] ?? [],
  options: {
    reveal?: boolean;
    fitCoverage?: boolean;
    signal?: AbortSignal;
    onApplied?: () => void;
  } = {}
) {
  if (options.signal?.aborted) return;
  suspended = false;
  const token = ++request;
  activationController?.abort();
  activationController = new AbortController();
  const controller = activationController;
  const signal = controller.signal;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  update({
    activeId: id,
    open: options.reveal === true ? true : state.open,
    loading: true,
    error: null,
    periods: { ...state.periods, [id]: period },
    excluded: { ...state.excluded, [id]: excluded }
  });

  persist();
  try {
    for (const [key, layer] of Object.entries(getMapStore().activeLayers)) {
      if (key.startsWith("theme-") && key !== themeLayerId(id) && layer.visible)
        getMapStore().toggleLayer(key);
    }
    const detail = await fetchThemeDetail(id, { period, excluded, signal, zoom: resolutionZoom });
    if (token !== request || signal.aborted) return;
    const details = { ...state.details, [id]: detail };
    syncThemeLayers(Object.values(details));
    update({ details });
    emit("layers-changed");
    for (const [layerId, layer] of Object.entries(getMapStore().activeLayers))
      if (layer.visible && layerId.startsWith("theme-") && layerId !== themeLayerId(id))
        getMapStore().toggleLayer(layerId);
    if (detail.ready) {
      getMapStore().activateLayer(themeLayerId(id), {
        period,
        revision: detail.revision ?? "",
        excluded: excluded.join(",")
      });
    }
    if (token !== request || signal.aborted) return;
    update({ loading: false });
    options.onApplied?.();
    const b = detail.coverageBbox;
    if (
      options.fitCoverage !== false &&
      b &&
      viewport &&
      (viewport[2] < b[0] || viewport[0] > b[2] || viewport[3] < b[1] || viewport[1] > b[3])
    ) {
      update({ returnBbox: viewport });
      emit("fit-bounds", { bbox: b });
    }
  } catch (error) {
    if (token === request)
      update({
        loading: false,
        error: error instanceof Error ? error.message : "Data unavailable"
      });
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
export function deactivateStatistic() {
  request++;
  activationController?.abort();
  suspended = false;
  update({ activeId: null, loading: false, selected: null, error: null });
  for (const [key, layer] of Object.entries(getMapStore().activeLayers)) {
    if (key.startsWith("theme-") && layer.visible) getMapStore().toggleLayer(key);
  }
  persist();
}

export async function loadExplorerRows(
  id: string,
  period: string,
  excluded: string[],
  offset = 0,
  signal?: AbortSignal
) {
  const q = new URLSearchParams({
    period,
    exclude: excluded.join(","),
    offset: String(offset),
    limit: "200",
    zoom: String(resolutionZoom),
    ...(viewport ? { bbox: viewport.map((v) => v.toFixed(4)).join(",") } : {})
  });
  return apiGet<{ rows: ExplorerRow[]; total: number }>(
    `/v2/themes/${encodeURIComponent(id)}/rows?${q}`,
    { signal }
  );
}
export function attachStatisticsRuntime() {
  let disposed = false;
  const url = new URL(window.location.href);
  const id = url.searchParams.get("stat");
  const period = url.searchParams.get("statPeriod") ?? "latest";
  suspended = url.searchParams.get("statPaused") === "true";
  if (id && suspended)
    update({
      activeId: id,
      open: true,
      periods: { ...state.periods, [id]: period },
      excluded: {
        ...state.excluded,
        [id]: (url.searchParams.get("statExclude") ?? "").split(",").filter(Boolean)
      }
    });
  try {
    const refs: unknown = JSON.parse(url.searchParams.get("statRegions") ?? "[]");
    if (Array.isArray(refs))
      update({
        regions: refs
          .filter(
            (r) =>
              r &&
              typeof r.code === "string" &&
              typeof r.level === "string" &&
              typeof r.name === "string"
          )
          .slice(0, 4)
      });
  } catch {
    /* Invalid shared state is ignored. */
  }
  persist();
  void fetchThemeSummaries()
    .then(async (catalog) => {
      if (disposed) return;
      update({ catalog });
      if (id && !suspended && catalog.some((t) => t.id === id))
        await activateStatistic(
          id,
          period,
          (url.searchParams.get("statExclude") ?? "").split(",").filter(Boolean)
        );
    })
    .catch(() => {
      if (!disposed) update({ error: "Statistický katalog se nepodařilo načíst." });
    });
  const offMode = on("mode-changed", ({ mode }) => {
    if (mode !== "discover") {
      suspended = Boolean(state.activeId);
      request++;
      update({ loading: false });
      persist();
    } else if (suspended && state.activeId) {
      suspended = false;
      void activateStatistic(state.activeId);
    }
  });
  let coverageController: AbortController | null = null;
  let coverageTimer: ReturnType<typeof setTimeout> | undefined;
  let coverageGeneration = 0;
  const offView = on("discover-viewport", (event) => {
    viewport = event.bbox;
    update({ viewportKey: event.bbox.map((v) => v.toFixed(4)).join(",") });
    const nextZoom = event.zoom >= 8 ? 8 : event.zoom >= 6 ? 6 : event.zoom >= 4 ? 4 : 0;
    if (nextZoom !== resolutionZoom) {
      resolutionZoom = nextZoom;
      if (state.activeId && !suspended)
        void activateStatistic(state.activeId, undefined, undefined, {
          reveal: false,
          fitCoverage: false
        });
    }
    clearTimeout(coverageTimer);
    coverageController?.abort();
    const generation = ++coverageGeneration;
    coverageTimer = setTimeout(() => {
      coverageController = new AbortController();
      void fetchThemeSummaries(coverageController.signal, event.bbox, event.zoom)
        .then((catalog) => {
          if (!disposed && generation === coverageGeneration) update({ catalog });
        })
        .catch(() => {});
    }, 350);
  });
  const off = on("theme-unit-selected", (event) => {
    update({
      activeId: event.themeId,
      selected: { code: event.code, level: event.geoLevel, name: event.name },
      open: true
    });
    persist();
  });
  const offLayers = on("layers-changed", () => {
    // Mode/layer notifications during activation must not restore the previous statistic.
    if (state.loading) return;
    const active = Object.entries(getMapStore().activeLayers)
      .find(([id, s]) => id.startsWith("theme-") && s.visible)?.[0]
      ?.slice(6);
    if (active && active !== state.activeId) {
      void activateStatistic(active);
    }
  });
  return () => {
    disposed = true;
    clearTimeout(coverageTimer);
    coverageController?.abort();
    activationController?.abort();
    off();
    offView();
    offMode();
    offLayers();
  };
}
