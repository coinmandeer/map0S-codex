import { layerUnavailableReason } from "../layers/registry";
import { watchLayerTiles } from "../tasks/tileActivity";
import { layerActivity } from "../tasks/layerActivity";
import { ApiError } from "../lib/api";
import type maplibregl from "maplibre-gl";
import type {
  Bbox,
  FeatureCollection,
  FilterValues,
  GeoFeature,
  LayerHandle,
  LayerRuntimeContext,
  PlacesResponse
} from "@mapos/layer-sdk";
import { assertFeatureQueryResultV2, featureV2ToV1, viewportCostOf } from "@mapos/layer-sdk";
import { isWeatherLayerId, isWeatherRadarLayerId } from "../layers/weather/controls";
import type { MapDataLayerLifecycle } from "@mapos/map-runtime";
import type { MapStore } from "../store/mapStore";
import {
  createLayerHandle,
  getLayerManifestV2,
  getLayerPlugin,
  type MapLayerPlugin
} from "../layers";
import { t } from "../i18n";
import { on } from "../lib/events";
import { TaskRegistry, taskRegistry } from "../tasks/TaskRegistry";
import { applyFeatureOwnership, ownedUserPinRefs } from "./featureOwnership";
import { safeBrowserErrorFields } from "../lib/safeError";
import { viewportDrift } from "./viewportCoverage";

type ActiveEntry = { visible: boolean; opacity: number; filters: FilterValues };

interface ManagedLayer {
  layerId: string;
  plugin: MapLayerPlugin;
  handle: LayerHandle;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const CACHE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_REFRESH_CONCURRENCY = 4;
const DEFAULT_REFRESH_DEBOUNCE_MS = 300;
/** Most of a screen, or a doubling of the span: past this, the previous answer was for a
 *  different place, and an expensive layer waits to be asked. */
const PIN_CONFIRM_DRIFT = 0.6;

export async function runBounded(jobs: Array<() => Promise<void>>, limit: number): Promise<void> {
  const workerCount = Math.max(1, Math.min(Math.trunc(limit) || 1, jobs.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (job) await job();
      }
    })
  );
}

/** Small client-side response cache keyed by layer + rounded bbox + filters, so panning back
 * to a recently-seen area (or reapplying the same filter) renders instantly while the network
 * request revalidates in the background. */
class FeatureCache {
  private store = new Map<
    string,
    { data: FeatureCollection; ts: number; bytes: number; ttl: number }
  >();
  private bytes = 0;

  key(
    sessionScope: string,
    layerId: string,
    bbox: Bbox,
    filters: FilterValues,
    revision: number
  ): string {
    const rounded = bbox.join(",");
    return `${sessionScope}|${layerId}|${revision}|${rounded}|${stableKey(filters)}`;
  }

  get(key: string): FeatureCollection | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts >= hit.ttl) {
      this.store.delete(key);
      this.bytes -= hit.bytes;
      return null;
    }
    // Treat reads as use so revisiting a map area keeps hot data while old fly-through tiles are
    // evicted first.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.data;
  }

  set(key: string, data: FeatureCollection, ttl = CACHE_TTL_MS) {
    const previous = this.store.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.store.delete(key);
    // Feature properties are the dominant part of the browser heap.  A byte budget complements
    // the entry cap so one unusually rich response cannot evict only a handful of tiny entries.
    const bytes = Math.max(128, JSON.stringify(data).length * 2);
    if (ttl <= 0) return;
    this.store.set(key, { data, ts: Date.now(), bytes, ttl });
    this.bytes += bytes;
    while (this.store.size > CACHE_MAX_ENTRIES || this.bytes > CACHE_MAX_BYTES) {
      const oldest = this.store.entries().next().value as
        [string, { data: FeatureCollection; ts: number; bytes: number }] | undefined;
      if (!oldest) break;
      this.store.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
  }

  stats() {
    return { entries: this.store.size, estimatedBytes: this.bytes, maxBytes: CACHE_MAX_BYTES };
  }

  invalidateLayer(scope: string, layerId: string) {
    const prefix = `${scope}|${layerId}|`;
    for (const [key, entry] of this.store) {
      if (!key.startsWith(prefix)) continue;
      this.store.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  clear() {
    this.store.clear();
    this.bytes = 0;
  }
}

function sessionScope(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : "anonymous";
}

export class LayerEngine {
  private managed = new Map<string, ManagedLayer>();
  private styles = new Map<string, { visible: boolean; opacity: number }>();
  private states = new Map<
    string,
    {
      key?: string;
      filterKey?: string;
      bbox?: Bbox;
      acceptedAt?: number;
      ttl?: number;
      status: "idle" | "loading" | "ready" | "partial" | "error" | "pending";
    }
  >();
  private layerData = new Map<string, FeatureCollection>();
  private renderedData = new Map<string, FeatureCollection>();
  private cache = new FeatureCache();
  private pluginRevisions = new WeakMap<MapLayerPlugin, number>();
  private nextPluginRevision = 0;
  private controllers = new Map<string, AbortController>();
  private tileObservers = new Map<string, () => void>();
  private taskIds = new Map<string, string>();
  private queue = new Map<string, () => Promise<void>>();
  private running = 0;
  private retries = new Map<string, ReturnType<typeof setTimeout>>();
  private retryCounts = new Map<string, number>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBbox: Bbox | null = null;
  private destroyed = false;
  private currentSessionScope: string;
  private offSessionChanged: () => void;

  constructor(
    private map: maplibregl.Map,
    private apiBase: string,
    private store: MapStore,
    private tasks: TaskRegistry = taskRegistry,
    private layerLifecycle: MapDataLayerLifecycle | null = null
  ) {
    this.currentSessionScope = sessionScope(store.session?.id);
    this.offSessionChanged = on("session-changed", ({ userId }) => {
      const scope = sessionScope(userId);
      if (scope === this.currentSessionScope) return;
      this.currentSessionScope = scope;
      for (const id of this.managed.keys()) this.invalidate(id);
      this.cache.clear();
      this.layerData.clear();
      this.renderedData.clear();
      this.states.clear();
      for (const [id, managed] of this.managed) {
        managed.handle.setData?.({ type: "FeatureCollection", features: [] });
        this.store.setVisibleFeatures(id, []);
        this.store.setLayerNotice(id, undefined);
      }
      if (this.lastBbox) this.doRefresh(this.lastBbox, true);
    });
  }

  private context(): LayerRuntimeContext {
    return {
      theme: this.store.theme,
      basemapId: this.store.basemapId,
      activeTag: this.store.activeTag,
      countryCode: this.store.countryCode,
      enabledPoiSources: this.store.enabledPoiSources
    };
  }

  private query(layerId: string, managed: ManagedLayer, bbox: Bbox) {
    // Shared URLs and restored older sessions can contain only a subset of the filters.
    // Keep plugin defaults (weather quantity, network, POI facets) in the runtime contract.
    const filters = {
      ...managed.plugin.defaultFilters,
      ...this.store.activeLayers[layerId]?.filters
    };
    let merged = managed.plugin.deriveFilters?.(filters, this.context()) ?? filters;
    const manifest = getLayerManifestV2(layerId);
    const area = this.store.mode !== "game" ? this.store.areaSelection : null;
    if (area && manifest?.queryPolicy.areaFilter === "geometry")
      merged = { ...merged, areaId: area.id, boundaryRevision: area.revision };
    const tiled =
      manifest?.source.type === "raster-tiles" ||
      manifest?.source.type === "vector-tiles" ||
      ((!manifest || manifest.source.type === "custom-runtime") &&
        (managed.plugin.kind === "vector" ||
          (managed.plugin.kind === "raster" && !isWeatherLayerId(layerId))));
    const global = manifest?.queryPolicy.strategy === "global";
    // A manual-strategy layer that draws its own clock (satellites, 3D world) or carries its
    // data in the manifest (AI answers) does not depend on the viewport: its cache key must not
    // change with every pan, or the engine re-runs its update on every map move.
    const manual =
      !layerId.startsWith("live-") &&
      manifest?.queryPolicy.strategy === "manual" &&
      (managed.plugin.kind === "custom-gl" || manifest?.source.type === "inline");
    const queryBbox: Bbox = global || manual || tiled ? [-180, -90, 180, 90] : bbox;
    let revision = this.pluginRevisions.get(managed.plugin);
    if (revision === undefined) {
      revision = ++this.nextPluginRevision;
      this.pluginRevisions.set(managed.plugin, revision);
    }
    return {
      filters: merged,
      filterKey: stableKey(merged),
      key: this.cache.key(this.currentSessionScope, layerId, queryBbox, merged, revision),
      global,
      tiled,
      manual,
      ttl: (manifest?.queryPolicy.cacheTtlSeconds ?? 600) * 1000
    };
  }

  syncLayers(active: Record<string, ActiveEntry>) {
    if (this.destroyed) return;
    let ownershipChanged = false;
    for (const [id, managed] of this.managed) {
      if (
        active[id]?.visible &&
        !layerUnavailableReason(id, this.store.capabilities, active[id]?.filters) &&
        getLayerPlugin(id) === managed.plugin
      )
        continue;
      if (getLayerPlugin(id) !== managed.plugin)
        this.cache.invalidateLayer(this.currentSessionScope, id);
      this.invalidate(id);
      managed.handle.detach();
      this.managed.delete(id);
      layerActivity.state(id, "off");
      this.styles.delete(id);
      this.states.delete(id);
      this.layerData.delete(id);
      this.renderedData.delete(id);
      ownershipChanged ||= id === "user-layers";
      this.store.setVisibleFeatures(id, []);
      this.store.setLayerNotice(id, undefined);
    }
    for (const [id, state] of Object.entries(active)) {
      if (!state.visible) continue;
      const unavailable = layerUnavailableReason(id, this.store.capabilities, active[id]?.filters);
      if (unavailable) {
        layerActivity.state(id, "coverage", unavailable);
        this.store.setLayerNotice(id, unavailable);
        continue;
      }
      let managed = this.managed.get(id);
      if (!managed) {
        const plugin = getLayerPlugin(id);
        if (!plugin) continue;
        const create = () => createLayerHandle(plugin, this.map, this.apiBase);
        managed = {
          layerId: id,
          plugin,
          handle: this.layerLifecycle?.attach({ id, create }) ?? create()
        };
        this.managed.set(id, managed);
      }
      const previous = this.styles.get(id);
      if (!previous || previous.visible !== state.visible) managed.handle.setVisible(state.visible);
      if (!previous || previous.opacity !== state.opacity) managed.handle.setOpacity(state.opacity);
      this.styles.set(id, { visible: state.visible, opacity: state.opacity });
    }
    if (ownershipChanged) this.reconcile();
    this.updatePending();
  }

  /** Reattach style resources from retained data without refetching every provider. */
  restoreStyle(bbox: Bbox) {
    if (this.destroyed) return;
    if (!this.layerLifecycle) {
      // v1 path: the handles themselves own their style resources, so they must be rebuilt.
      for (const id of this.managed.keys()) this.invalidate(id);
      for (const managed of this.managed.values()) managed.handle.detach();
      this.managed.clear();
      this.styles.clear();
      this.renderedData.clear();
      this.syncLayers(this.store.activeLayers);
      for (const [id, data] of this.layerData) this.accept(id, data);
    } else {
      // The lifecycle's style.load handler already replaced every concrete handle behind the
      // stable proxies and replayed lastData/visibility/opacity on them. Detaching the proxies
      // here would destroy those fresh handles and create every layer twice per style switch.
      for (const id of this.managed.keys()) this.invalidate(id);
      this.renderedData.clear();
      for (const [id, data] of this.layerData) this.accept(id, data);
    }
    // Tile/custom handles need to attach to the new style even with an unchanged filter.
    for (const [id, managed] of this.managed) {
      if (this.query(id, managed, bbox).tiled || managed.plugin.kind !== "pins")
        this.states.delete(id);
    }
    this.refresh(bbox);
  }

  /** Invalidate obsolete work immediately, including the debounce interval. */
  refresh(bbox: Bbox, force = false) {
    if (this.destroyed) return;
    this.lastBbox = bbox;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const [id, managed] of this.managed) {
      if (
        !this.store.activeLayers[id]?.visible ||
        this.states.get(id)?.key !== this.query(id, managed, bbox).key
      )
        this.invalidate(id);
    }
    for (const [id, managed] of this.managed) {
      const next = this.query(id, managed, bbox);
      const previous = this.states.get(id);
      if (
        previous &&
        previous.filterKey !== next.filterKey &&
        this.layerData.get(id)?.features.length
      ) {
        this.accept(id, { type: "FeatureCollection", features: [] });
      }
    }
    this.updatePending();
    if (force) {
      this.doRefresh(bbox, true);
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.doRefresh(bbox, false);
    }, DEFAULT_REFRESH_DEBOUNCE_MS);
  }

  private invalidate(id: string) {
    this.tileObservers.get(id)?.();
    this.tileObservers.delete(id);
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.queue.delete(id);
    const timer = this.retries.get(id);
    if (timer) clearTimeout(timer);
    this.retries.delete(id);
    const taskId = this.taskIds.get(id);
    if (taskId) {
      if (this.tasks.get(taskId)?.status === "failed") this.tasks.dismiss(taskId);
      else this.tasks.markStale(taskId);
    }
    this.taskIds.delete(id);
    const state = this.states.get(id);
    if (state?.status === "loading") state.status = "idle";
    this.store.setLayerLoading(id, false);
  }

  private doRefresh(bbox: Bbox, force: boolean) {
    this.syncLayers(this.store.activeLayers);
    for (const [id, managed] of this.managed) {
      if (
        managed.plugin.minQueryZoom != null &&
        this.store.view.zoom < managed.plugin.minQueryZoom
      ) {
        this.invalidate(id);
        this.accept(id, { type: "FeatureCollection", features: [] });
        this.states.delete(id);
        layerActivity.state(id, "zoom");
        this.store.setLayerNotice(
          id,
          `Přibližte mapu alespoň na úroveň ${managed.plugin.minQueryZoom}.`
        );
        continue;
      }
      const query = this.query(id, managed, bbox);
      const state = this.states.get(id);
      if (this.controllers.has(id) && state?.key === query.key) continue;
      const sameFilters = state?.filterKey === query.filterKey;
      const fresh =
        state?.acceptedAt != null && Date.now() - state.acceptedAt < (state.ttl ?? query.ttl);
      const covered = state?.bbox && containsBbox(state.bbox, bbox);
      if (
        !force &&
        sameFilters &&
        fresh &&
        state.status === "ready" &&
        (query.global || query.tiled || query.manual || (covered && managed.plugin.kind === "pins"))
      )
        continue;
      if (
        !force &&
        sameFilters &&
        state?.bbox &&
        viewportCostOf(managed.plugin) === "expensive" &&
        !query.global &&
        viewportDrift(state.bbox, bbox) > PIN_CONFIRM_DRIFT
      ) {
        state.status = "pending";
        layerActivity.state(id, "pending");
        continue;
      }
      this.invalidate(id);
      const controller = new AbortController();
      this.controllers.set(id, controller);
      this.states.set(id, { ...state, key: query.key, status: "loading" });
      layerActivity.begin(id);
      const job = () => this.refreshOne(id, managed, bbox, query, controller, force);
      // Tile attachment is synchronous. It never waits behind external feature queries.
      if (query.tiled) void job();
      else {
        this.queue.set(id, job);
        this.drain();
      }
    }
    this.updatePending();
  }

  private drain() {
    while (!this.destroyed && this.running < MAX_REFRESH_CONCURRENCY && this.queue.size) {
      const [id, job] = this.queue.entries().next().value!;
      this.queue.delete(id);
      this.running++;
      void job().finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async refreshOne(
    id: string,
    managed: ManagedLayer,
    bbox: Bbox,
    query: ReturnType<LayerEngine["query"]>,
    controller: AbortController,
    force: boolean
  ) {
    const current = () =>
      !this.destroyed &&
      !controller.signal.aborted &&
      this.controllers.get(id) === controller &&
      this.managed.get(id) === managed &&
      Boolean(this.store.activeLayers[id]?.visible);
    if (!current()) return;
    const generation = layerActivity.get(id)?.generation ?? layerActivity.begin(id);
    const startedAt = Date.now();
    layerActivity.patch(id, generation, { phase: "loading" });
    const cached = this.cache.get(query.key);
    const previousTaskId = this.taskIds.get(id);
    if (previousTaskId && this.tasks.get(previousTaskId)?.status === "failed")
      this.tasks.dismiss(previousTaskId);
    const task = this.tasks.start({
      type: isWeatherLayerId(id)
        ? "weather"
        : managed.plugin.kind === "pins"
          ? "layer-query"
          : managed.plugin.kind === "custom-gl"
            ? "game-asset"
            : "tile-load",
      label: t("activity.loadingLayer", { name: managed.plugin.manifest.name }),
      layerId: id,
      cancellable: true,
      cancel: () => {
        this.invalidate(id);
        const state = this.states.get(id);
        if (state) state.status = "pending";
        this.updatePending();
      },
      retry: () => {
        if (this.lastBbox) this.refreshLayer(id, this.lastBbox);
      },
      telemetry: { cache: cached ? "hit" : "miss", budget: 100 }
    });
    this.taskIds.set(id, task.id);
    this.store.setLayerLoading(id, true);
    try {
      const data =
        !force && cached
          ? cached
          : await managed.handle.update(bbox, query.filters, controller.signal);
      if (!current()) return;
      if (data) {
        if (data.query?.status !== "unavailable") {
          this.cache.set(query.key, data, data.query?.cacheTtlMs ?? query.ttl);
          this.accept(id, data);
        }
        const meta = (data as FeatureCollection & { meta?: PlacesResponse["meta"] }).meta;
        if (meta) this.store.applySourceMeta(meta.sources);
        const incomplete = data.query?.status === "partial" || data.query?.truncated;
        const unavailable = data.query?.status === "unavailable";
        this.store.setLayerNotice(
          id,
          data.notice ??
            (unavailable
              ? t("layers.loadFailed")
              : incomplete && data.query?.retryAfterMs
                ? "Další výsledky se načítají…"
                : incomplete
                  ? "Výsledky jsou částečné. Přibliž mapu nebo obnov tuto oblast."
                  : undefined)
        );
      }
      const status =
        data?.query?.status === "unavailable"
          ? "error"
          : data?.query?.status === "partial" || data?.query?.truncated
            ? "partial"
            : "ready";
      this.states.set(id, {
        key: query.key,
        filterKey: query.filterKey,
        bbox: data?.query?.bbox ?? bbox,
        acceptedAt: Date.now(),
        ttl: data?.query?.cacheTtlMs ?? query.ttl,
        status
      });
      if (status === "error")
        this.tasks.fail(task.id, {
          code: "LAYER_UNAVAILABLE",
          message: data?.notice ?? "Zdroj není dostupný",
          retryable: true
        });
      else if (!query.tiled && !isWeatherRadarLayerId(id))
        this.tasks.succeed(
          task.id,
          data ? { received: data.query?.rendered?.count ?? data.features.length } : {}
        );
      if (data || !id.startsWith("live-"))
        layerActivity.patch(id, generation, {
          phase:
            data?.query?.reason === "zoom-required"
              ? "zoom"
              : data?.query?.reason === "outside-coverage"
                ? "coverage"
                : data?.query?.reason === "budget-exhausted"
                  ? "budget"
                  : status === "ready" &&
                      data &&
                      (data.query?.rendered?.count ?? data.features.length) === 0
                    ? "empty"
                    : status,
          ...(data
            ? {
                count: data.query?.rendered?.count ?? data.features.length,
                unit: data.query?.rendered?.unit ?? ("places" as const)
              }
            : {}),
          durationMs: Date.now() - startedAt,
          cache: !force && !!cached,
          message: data?.notice
        });
      if (query.tiled || isWeatherRadarLayerId(id)) {
        layerActivity.patch(id, generation, { phase: "rendering", unit: "tiles" });
        this.tileObservers.set(
          id,
          watchLayerTiles(this.map, id, generation, (partial) => {
            if (partial)
              this.tasks.fail(task.id, {
                code: "TILE_PARTIAL",
                message: "Některé dlaždice chybí",
                retryable: true
              });
            else this.tasks.succeed(task.id);
          })
        );
      }

      if (data?.query?.retryAfterMs && status === "partial") {
        const count = (this.retryCounts.get(query.key) ?? 0) + 1;
        this.retryCounts.set(query.key, count);
        while (this.retryCounts.size > 100)
          this.retryCounts.delete(this.retryCounts.keys().next().value!);
        if (count <= 8) {
          this.retries.set(
            id,
            setTimeout(
              () => {
                this.retries.delete(id);
                if (
                  !this.destroyed &&
                  this.lastBbox &&
                  this.managed.get(id) === managed &&
                  this.query(id, managed, this.lastBbox).key === query.key
                )
                  this.refreshLayer(id, this.lastBbox);
              },
              Math.max(1000, Math.min(data.query.retryAfterMs, 15000))
            )
          );
        }
      }
    } catch (error) {
      if (current()) {
        layerActivity.patch(id, generation, {
          phase: "error",
          message: "Zdroj neodpověděl",
          durationMs: Date.now() - startedAt
        });
        console.warn(`Layer ${id} refresh failed`, safeBrowserErrorFields(error));
        this.states.set(id, {
          ...this.states.get(id),
          filterKey: query.filterKey,
          status: "error"
        });
        this.store.setLayerNotice(
          id,
          error instanceof ApiError && error.status === 409 && query.filters.areaId
            ? "Oblast není dostupná. Obnovte výběr oblasti nebo jej zrušte."
            : t("layers.loadFailed")
        );
        this.tasks.fail(task.id, {
          code: "LAYER_QUERY_FAILED",
          message: t("layers.loadFailed"),
          retryable: true
        });
      }
    } finally {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id);
        this.store.setLayerLoading(id, false);
      }
      this.updatePending();
    }
  }

  refreshLayer(id: string, bbox: Bbox) {
    const managed = this.managed.get(id);
    if (!managed || !this.store.activeLayers[id]?.visible) return;
    if (managed.plugin.minQueryZoom != null && this.store.view.zoom < managed.plugin.minQueryZoom)
      return;
    this.invalidate(id);
    const query = this.query(id, managed, bbox);
    if (
      this.states.get(id)?.filterKey !== query.filterKey &&
      this.layerData.get(id)?.features.length
    )
      this.accept(id, { type: "FeatureCollection", features: [] });
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.states.set(id, { ...this.states.get(id), key: query.key, status: "loading" });
    layerActivity.begin(id);
    const job = () => this.refreshOne(id, managed, bbox, query, controller, true);
    if (query.tiled) void job();
    else {
      this.queue.set(id, job);
      this.drain();
    }
  }

  private accept(id: string, data: FeatureCollection) {
    this.layerData.set(id, data);
    this.reconcile(id === "user-layers" ? undefined : id);
  }

  private reconcile(changedId?: string) {
    const refs = ownedUserPinRefs(this.layerData.get("user-layers"));
    for (const [id, managed] of this.managed) {
      if (changedId && changedId !== id) continue;
      const raw = this.layerData.get(id);
      if (!raw) continue;
      const data = applyFeatureOwnership(id, raw, refs);
      const previous = this.renderedData.get(id);
      if (
        previous === data ||
        (previous &&
          previous.features.length === data.features.length &&
          previous.features.every((feature, index) => feature === data.features[index]))
      )
        continue;
      this.renderedData.set(id, data);
      managed.handle.setData?.(data);
      this.store.setVisibleFeatures(id, data.features);
    }
  }

  private updatePending() {
    const bbox = this.lastBbox;
    this.store.setSearchHerePending(
      [...this.managed].some(([id, managed]) => {
        if (
          !this.store.activeLayers[id]?.visible ||
          (managed.plugin.minQueryZoom != null &&
            this.store.view.zoom < managed.plugin.minQueryZoom)
        )
          return false;
        const state = this.states.get(id);
        if (state?.status === "partial" || state?.status === "error" || state?.status === "pending")
          return true;
        if (!bbox || !state?.bbox || viewportCostOf(managed.plugin) !== "expensive") return false;
        const query = this.query(id, managed, bbox);
        return !query.global && !query.tiled && !containsBbox(state.bbox, bbox);
      })
    );
  }

  /** Counts only; no private coordinates, filters or user content enter diagnostics. */
  diagnostics() {
    return {
      attached: this.managed.size,
      queued: this.queue.size,
      running: this.running,
      requests: this.controllers.size,
      retries: this.retries.size,
      cache: this.cache.stats()
    };
  }

  handlePinClick(layerId: string, feature: GeoFeature) {
    this.store.selectPin({ feature, layerId });
  }

  destroy() {
    this.destroyed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.offSessionChanged();
    for (const id of this.managed.keys()) this.invalidate(id);
    for (const managed of this.managed.values()) managed.handle.detach();
    this.managed.clear();
    this.states.clear();
    this.styles.clear();
    this.layerData.clear();
    this.renderedData.clear();
    this.cache.clear();
    this.retryCounts.clear();
  }
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableKey((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function containsBbox(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}

export async function fetchLayerFeatures(
  apiBase: string,
  layerId: string,
  bbox: Bbox,
  filters: FilterValues,
  signal?: AbortSignal,
  contractVersion: 1 | 2 = 1
): Promise<FeatureCollection> {
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    ...Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])
    )
  });
  if (contractVersion === 2) params.set("limit", "100");
  const path =
    contractVersion === 2 ? `/v2/layers/${layerId}/features` : `/layers/${layerId}/features`;
  const res = await fetch(`${apiBase}${path}?${params}`, { signal });
  if (!res.ok) throw new ApiError(res.status, `Failed to fetch ${layerId}: ${res.status}`);
  // Accounting works off the raw body length instead of re-stringifying the parsed object:
  // a 1 MB response cost three full serializations of the decoded data before (two here, one
  // in the engine's cache), which showed up as measurable CPU in the performance report.
  const decode = (text: string): FeatureCollection => {
    const result: unknown = JSON.parse(text);
    if (contractVersion === 1) return result as FeatureCollection;
    assertFeatureQueryResultV2(result);
    return {
      type: "FeatureCollection",
      features: result.data.features.map(featureV2ToV1),
      query: {
        status: result.notices.some((notice) => notice.code === "viewport-too-large")
          ? "unavailable"
          : result.meta.sources.some((source) => source.state === "unavailable")
            ? result.data.features.length
              ? "partial"
              : "unavailable"
            : result.meta.truncated ||
                result.notices.some((notice) => notice.code === "partial-results")
              ? "partial"
              : "complete",
        reason: result.notices.some((notice) => notice.code === "viewport-too-large")
          ? "zoom-required"
          : undefined,
        truncated: result.meta.truncated,
        nextCursor: result.meta.nextCursor,
        revision: result.meta.taskId
      },
      ...(result.notices[0]?.message ? { notice: result.notices[0].message } : {})
    };
  };
  const firstText = await res.text();
  const first = decode(firstText);
  let page = first;
  const features = [...first.features];
  const seen = new Set<string>();
  let bytes = firstText.length * 2;
  while (page.query?.nextCursor && features.length < 8000 && bytes < 8 * 1024 * 1024) {
    signal?.throwIfAborted();
    const cursor = page.query.nextCursor;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    params.set("cursor", cursor);
    try {
      const next = await fetch(`${apiBase}${path}?${params}`, { signal });
      if (next.status === 409 && params.has("areaId"))
        throw new ApiError(409, "Boundary edition unavailable");
      if (!next.ok) break;
      const nextText = await next.text();
      const decoded = decode(nextText);
      const pageBytes = nextText.length * 2;
      if (features.length + decoded.features.length > 8000 || bytes + pageBytes > 8 * 1024 * 1024)
        break;
      page = decoded;
      features.push(...page.features);
      bytes += pageBytes;
    } catch (error) {
      if (signal?.aborted || (error instanceof ApiError && error.status === 409)) throw error;
      break;
    }
  }
  return { ...first, features, query: page.query };
}
