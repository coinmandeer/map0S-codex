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
import type { MapDataLayerLifecycle } from "@mapos/map-runtime";
import type { MapStore } from "../store/mapStore";
import {
  createLayerHandle,
  getLayerManifestV2,
  getLayerPlugin,
  type MapLayerPlugin
} from "../layers";
import { on } from "../lib/events";
import { TaskRegistry, taskRegistry } from "../tasks/TaskRegistry";
import { applyFeatureOwnership, ownedUserPinRefs } from "./featureOwnership";
import { safeBrowserErrorFields } from "../lib/safeError";

type ActiveEntry = { visible: boolean; opacity: number; filters: FilterValues };

interface ManagedLayer {
  layerId: string;
  plugin: MapLayerPlugin;
  handle: LayerHandle;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const MAX_REFRESH_CONCURRENCY = 4;

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
  private store = new Map<string, { data: FeatureCollection; ts: number }>();

  key(sessionScope: string, layerId: string, bbox: Bbox, filters: FilterValues): string {
    const rounded = bbox.map((n) => Math.round(n * 80) / 80).join(",");
    return `${sessionScope}|${layerId}|${rounded}|${JSON.stringify(filters)}`;
  }

  get(key: string): FeatureCollection | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_MS) {
      this.store.delete(key);
      return null;
    }
    return hit.data;
  }

  set(key: string, data: FeatureCollection) {
    this.store.delete(key);
    this.store.set(key, { data, ts: Date.now() });
    if (this.store.size > CACHE_MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
  }

  clear() {
    this.store.clear();
  }
}

function sessionScope(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : "anonymous";
}

export class LayerEngine {
  private map: maplibregl.Map;
  private apiBase: string;
  private store: MapStore;
  private tasks: TaskRegistry;
  private managed = new Map<string, ManagedLayer>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBbox: Bbox | null = null;
  /** Bbox of the last successful pin-layer fetch — used to decide when to show "Hledat zde". */
  private lastPinFetchBbox: Bbox | null = null;
  private cache = new FeatureCache();
  private abortControllers = new Map<string, AbortController>();
  private layerTaskIds = new Map<string, string>();
  /** Invalidates requests even when a third-party handle ignores AbortSignal. */
  private sessionGeneration = 0;
  /** Invalidates queued and in-flight work from a superseded viewport refresh. */
  private refreshGeneration = 0;
  private currentSessionScope: string;
  private offSessionChanged: () => void;
  private layerLifecycle: MapDataLayerLifecycle | null;
  /** Unfiltered responses. Rendering is derived from these so switching the personal layer off
   * can restore its fused community copies without another network request. */
  private layerData = new Map<string, FeatureCollection>();

  constructor(
    map: maplibregl.Map,
    apiBase: string,
    store: MapStore,
    tasks: TaskRegistry = taskRegistry,
    layerLifecycle: MapDataLayerLifecycle | null = null
  ) {
    this.map = map;
    this.apiBase = apiBase;
    this.store = store;
    this.tasks = tasks;
    this.layerLifecycle = layerLifecycle;
    this.currentSessionScope = sessionScope(store.session?.id);
    this.offSessionChanged = on("session-changed", ({ userId }) => {
      this.handleSessionChanged(userId);
    });
  }

  /**
   * Authentication may change without a page reload. Private layer responses therefore cannot
   * survive an identity boundary in memory or on the map. Aborting is only the first guard: a
   * plugin may ignore the signal, so every request also captures `sessionGeneration` and a late
   * response from the previous identity is discarded.
   */
  private handleSessionChanged(userId: string | null) {
    const nextScope = sessionScope(userId);
    if (nextScope === this.currentSessionScope) return;

    this.currentSessionScope = nextScope;
    this.sessionGeneration += 1;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshGeneration += 1;
    for (const controller of this.abortControllers.values()) controller.abort();
    for (const taskId of this.layerTaskIds.values()) {
      this.retireLayerTask(taskId, "Změnila se aktivní identita");
    }
    this.abortControllers.clear();
    this.layerTaskIds.clear();
    this.cache.clear();
    this.layerData.clear();
    this.lastPinFetchBbox = null;

    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const [layerId, managed] of this.managed) {
      managed.handle.setData?.(empty);
      this.store.setVisibleFeatures(layerId, []);
      this.store.setLayerNotice(layerId, undefined);
      this.store.setLayerLoading(layerId, false);
    }

    // The session is already patched in MapStore before the event is emitted, so this request is
    // made with the new cookie and repopulates visible layers without waiting for a map move.
    if (this.lastBbox) void this.doRefresh(this.lastBbox, true);
  }

  syncLayers(active: Record<string, ActiveEntry>) {
    for (const [layerId, state] of Object.entries(active)) {
      const managed = this.ensureAttached(layerId);
      if (!managed) continue;
      managed.handle.setVisible(state.visible);
      managed.handle.setOpacity(state.opacity);
    }

    let ownershipChanged = false;
    for (const layerId of this.managed.keys()) {
      if (!active[layerId]?.visible) {
        const taskId = this.layerTaskIds.get(layerId);
        if (taskId) {
          const task = this.tasks.get(taskId);
          if (task?.status === "failed") this.tasks.dismiss(taskId);
          else this.tasks.cancel(taskId);
        } else this.abortControllers.get(layerId)?.abort();
        this.abortControllers.delete(layerId);
        this.layerTaskIds.delete(layerId);
        this.managed.get(layerId)?.handle.detach();
        this.managed.delete(layerId);
        ownershipChanged = this.layerData.delete(layerId) || ownershipChanged;
        this.store.setVisibleFeatures(layerId, []);
        this.store.setLayerLoading(layerId, false);
      }
    }
    if (ownershipChanged) this.reconcilePinLayers();
  }

  private acceptLayerData(layerId: string, managed: ManagedLayer, data: FeatureCollection) {
    this.layerData.set(layerId, data);
    if (managed.plugin.kind === "pins") {
      this.reconcilePinLayers();
      return;
    }
    managed.handle.setData?.(data);
    this.store.setVisibleFeatures(layerId, data.features);
  }

  /** Re-renders all pin collections together. This is the one ownership boundary between the
   * public community catalogue and the user's editable layers. */
  private reconcilePinLayers() {
    const ownedRefs = ownedUserPinRefs(this.layerData.get("user-layers"));
    for (const [layerId, managed] of this.managed) {
      if (managed.plugin.kind !== "pins") continue;
      const raw = this.layerData.get(layerId);
      if (!raw) continue;
      const visible = applyFeatureOwnership(layerId, raw, ownedRefs);
      managed.handle.setData?.(visible);
      this.store.setVisibleFeatures(layerId, visible.features);
    }
  }

  private attachLayer(layerId: string): ManagedLayer | undefined {
    const plugin = getLayerPlugin(layerId);
    if (!plugin) {
      console.warn(`No layer plugin registered for "${layerId}" — ignoring.`);
      return undefined;
    }
    const create = () => createLayerHandle(plugin, this.map, this.apiBase);
    const managed: ManagedLayer = {
      layerId,
      plugin,
      handle: this.layerLifecycle?.attach({ id: layerId, create }) ?? create()
    };
    this.managed.set(layerId, managed);
    return managed;
  }

  private ensureAttached(layerId: string): ManagedLayer | undefined {
    return this.managed.get(layerId) ?? this.attachLayer(layerId);
  }

  /** A newer request for the same layer replaces its old visible failure. Running work remains
   * traceable as stale, while terminal history from unrelated layers is left untouched. */
  private retireLayerTask(taskId: string, message?: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === "failed") {
      this.tasks.dismiss(taskId);
      return;
    }
    if (task.status === "running") this.tasks.markStale(taskId, message);
  }

  /** The slice of app state layers are allowed to fold into their requests. */
  private runtimeContext(): LayerRuntimeContext {
    return {
      activeTag: this.store.activeTag,
      countryCode: this.store.countryCode,
      enabledPoiSources: this.store.enabledPoiSources
    };
  }

  /** @param force when true (Search here / filter change), always fetch pin layers.
   *  On plain map moves, pin layers only refetch if the viewport hasn't drifted — otherwise
   *  we surface the Search-here button so dense Overpass queries aren't fired on every pan. */
  refresh(bbox: Bbox, force = false) {
    this.lastBbox = bbox;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.doRefresh(bbox, force), 250);
  }

  private pinLayersNeedConfirm(bbox: Bbox): boolean {
    if (!this.lastPinFetchBbox) return false;
    const [w0, s0, e0, n0] = this.lastPinFetchBbox;
    const [w1, s1, e1, n1] = bbox;
    const cx0 = (w0 + e0) / 2;
    const cy0 = (s0 + n0) / 2;
    const cx1 = (w1 + e1) / 2;
    const cy1 = (s1 + n1) / 2;
    const span = Math.max(e0 - w0, n0 - s0, 0.001);
    const drift = Math.hypot(cx1 - cx0, cy1 - cy0) / span;
    const sizeRatio = Math.max(e1 - w1, n1 - s1) / span;
    return drift > 0.35 || sizeRatio > 1.6 || sizeRatio < 0.55;
  }

  private async doRefresh(bbox: Bbox, force: boolean) {
    const refreshGeneration = ++this.refreshGeneration;
    for (const controller of this.abortControllers.values()) controller.abort();
    for (const taskId of this.layerTaskIds.values()) this.retireLayerTask(taskId);
    this.abortControllers.clear();
    this.layerTaskIds.clear();

    const active = this.store.activeLayers;
    const confirmPins = !force && this.pinLayersNeedConfirm(bbox);
    if (confirmPins) this.store.setSearchHerePending(true);
    else if (force) this.store.setSearchHerePending(false);

    const jobs: Array<() => Promise<void>> = [];
    for (const layerId of Object.keys(active)) {
      const state = active[layerId];
      if (!state?.visible) continue;
      const managed = this.ensureAttached(layerId);
      if (!managed) continue;
      const expensive = viewportCostOf(managed.plugin) === "expensive";
      // An expensive layer waits to be asked ("Search here") rather than re-querying Overpass
      // on every pan; a cheap one just follows the map.
      if (!force && confirmPins && expensive) continue;
      jobs.push(async () => {
        if (refreshGeneration !== this.refreshGeneration) return;
        await this.refreshOne(
          layerId,
          managed,
          bbox,
          state.filters,
          force && expensive,
          force,
          refreshGeneration
        );
      });
    }
    await runBounded(jobs, MAX_REFRESH_CONCURRENCY);
  }

  private async refreshOne(
    layerId: string,
    managed: ManagedLayer,
    bbox: Bbox,
    filters: FilterValues,
    markPinFetch = false,
    forceRefresh = false,
    refreshGeneration = this.refreshGeneration
  ) {
    const requestGeneration = this.sessionGeneration;
    const requestSessionScope = this.currentSessionScope;
    const mergedFilters = managed.plugin.deriveFilters?.(filters, this.runtimeContext()) ?? filters;
    const globalQuery = getLayerManifestV2(layerId)?.queryPolicy.strategy === "global";
    const cacheBbox: Bbox = globalQuery ? [-180, -90, 180, 90] : bbox;
    const cacheKey = this.cache.key(requestSessionScope, layerId, cacheBbox, mergedFilters);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.acceptLayerData(layerId, managed, cached);
      // A global personal collection is invariant under map movement. Revalidating it for every
      // pan wastes mobile data and causes visible churn; explicit layer/session changes use force.
      if (globalQuery && !forceRefresh) {
        this.store.setLayerLoading(layerId, false);
        return;
      }
    } else {
      this.store.setLayerLoading(layerId, true);
    }

    const previousTaskId = this.layerTaskIds.get(layerId);
    if (previousTaskId) this.retireLayerTask(previousTaskId);
    this.abortControllers.get(layerId)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(layerId, controller);
    const task = this.tasks.start({
      type:
        layerId === "weather"
          ? "weather"
          : managed.plugin.kind === "pins"
            ? "layer-query"
            : managed.plugin.kind === "custom-gl"
              ? "game-asset"
              : "tile-load",
      label: `Načítám ${managed.plugin.manifest.name}`,
      layerId,
      cancellable: true,
      cancel: () => controller.abort(),
      retry: () =>
        this.refreshOne(
          layerId,
          managed,
          bbox,
          filters,
          markPinFetch,
          true,
          this.refreshGeneration
        ),
      telemetry: { cache: cached ? "hit" : "miss", budget: 100 }
    });
    this.layerTaskIds.set(layerId, task.id);

    if (managed.plugin.reportsSourceStatus) {
      this.store.markSourcesLoading(this.store.enabledPoiSources);
    }

    try {
      const data = await managed.handle.update(bbox, mergedFilters, controller.signal);
      const current =
        !controller.signal.aborted &&
        requestGeneration === this.sessionGeneration &&
        refreshGeneration === this.refreshGeneration &&
        requestSessionScope === this.currentSessionScope &&
        this.managed.get(layerId) === managed;
      if (current) {
        if (data) {
          this.cache.set(cacheKey, data);
          this.acceptLayerData(layerId, managed, data);
          // An upstream that refused the request explains itself here; an area that genuinely
          // has nothing in it clears any previous explanation.
          this.store.setLayerNotice(layerId, data.notice);
          const meta = (data as FeatureCollection & { meta?: PlacesResponse["meta"] }).meta;
          if (meta) this.store.applySourceMeta(meta.sources);
          if (markPinFetch || viewportCostOf(managed.plugin) === "expensive") {
            this.lastPinFetchBbox = bbox;
            this.store.setSearchHerePending(false);
          }
        }
        this.tasks.succeed(task.id, { received: data?.features.length ?? 0 });
      } else if (!controller.signal.aborted) {
        this.tasks.markStale(task.id);
      }
    } catch (err) {
      if (
        !controller.signal.aborted &&
        !(err instanceof DOMException && err.name === "AbortError")
      ) {
        console.warn(`Layer ${layerId} refresh failed`, safeBrowserErrorFields(err));
        this.tasks.fail(task.id, {
          code: "LAYER_QUERY_FAILED",
          message: "Vrstva se nepodařila načíst",
          retryable: true
        });
      }
    } finally {
      if (this.abortControllers.get(layerId) === controller) {
        this.abortControllers.delete(layerId);
        if (
          this.layerTaskIds.get(layerId) === task.id &&
          this.tasks.get(task.id)?.status !== "failed"
        ) {
          this.layerTaskIds.delete(layerId);
        }
        this.store.setLayerLoading(layerId, false);
      }
    }
  }

  handlePinClick(layerId: string, feature: GeoFeature) {
    this.store.selectPin({ feature, layerId });
  }

  destroy() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.offSessionChanged();
    this.refreshGeneration += 1;
    for (const [layerId, controller] of this.abortControllers) {
      const taskId = this.layerTaskIds.get(layerId);
      if (taskId) this.tasks.cancel(taskId);
      else controller.abort();
    }
    for (const taskId of this.layerTaskIds.values()) {
      if (this.tasks.get(taskId)?.status === "failed") this.tasks.dismiss(taskId);
    }
    this.abortControllers.clear();
    this.layerTaskIds.clear();
    for (const managed of this.managed.values()) {
      managed.handle.detach();
    }
    this.managed.clear();
    this.layerData.clear();
    this.cache.clear();
  }
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
  if (!res.ok) throw new Error(`Failed to fetch ${layerId}: ${res.status}`);
  if (contractVersion === 1) return res.json() as Promise<FeatureCollection>;

  const result: unknown = await res.json();
  assertFeatureQueryResultV2(result);
  return {
    type: "FeatureCollection",
    features: result.data.features.map(featureV2ToV1),
    ...(result.notices[0]?.message ? { notice: result.notices[0].message } : {})
  };
}
