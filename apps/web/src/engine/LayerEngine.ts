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
import { viewportCostOf } from "@mapos/layer-sdk";
import type { MapStore } from "../store/mapStore";
import { createLayerHandle, getLayerPlugin, type MapLayerPlugin } from "../layers";

type ActiveEntry = { visible: boolean; opacity: number; filters: FilterValues };

interface ManagedLayer {
  layerId: string;
  plugin: MapLayerPlugin;
  handle: LayerHandle;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

/** Small client-side response cache keyed by layer + rounded bbox + filters, so panning back
 * to a recently-seen area (or reapplying the same filter) renders instantly while the network
 * request revalidates in the background. */
class FeatureCache {
  private store = new Map<string, { data: FeatureCollection; ts: number }>();

  key(layerId: string, bbox: Bbox, filters: FilterValues): string {
    const rounded = bbox.map((n) => Math.round(n * 80) / 80).join(",");
    return `${layerId}|${rounded}|${JSON.stringify(filters)}`;
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
}

export class LayerEngine {
  private map: maplibregl.Map;
  private apiBase: string;
  private store: MapStore;
  private managed = new Map<string, ManagedLayer>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBbox: Bbox | null = null;
  /** Bbox of the last successful pin-layer fetch — used to decide when to show "Hledat zde". */
  private lastPinFetchBbox: Bbox | null = null;
  private cache = new FeatureCache();
  private abortControllers = new Map<string, AbortController>();

  constructor(map: maplibregl.Map, apiBase: string, store: MapStore) {
    this.map = map;
    this.apiBase = apiBase;
    this.store = store;
  }

  syncLayers(active: Record<string, ActiveEntry>) {
    for (const [layerId, state] of Object.entries(active)) {
      const managed = this.ensureAttached(layerId);
      if (!managed) continue;
      managed.handle.setVisible(state.visible);
      managed.handle.setOpacity(state.opacity);
      if (this.lastBbox) {
        void this.refreshOne(layerId, managed, this.lastBbox, state.filters);
      }
    }

    for (const layerId of this.managed.keys()) {
      if (!active[layerId]?.visible) {
        this.abortControllers.get(layerId)?.abort();
        this.abortControllers.delete(layerId);
        this.managed.get(layerId)?.handle.detach();
        this.managed.delete(layerId);
        this.store.setLayerLoading(layerId, false);
      }
    }
  }

  private attachLayer(layerId: string): ManagedLayer | undefined {
    const plugin = getLayerPlugin(layerId);
    if (!plugin) {
      console.warn(`No layer plugin registered for "${layerId}" — ignoring.`);
      return undefined;
    }
    const managed: ManagedLayer = {
      layerId,
      plugin,
      handle: createLayerHandle(plugin, this.map, this.apiBase)
    };
    this.managed.set(layerId, managed);
    return managed;
  }

  private ensureAttached(layerId: string): ManagedLayer | undefined {
    return this.managed.get(layerId) ?? this.attachLayer(layerId);
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
    const active = this.store.activeLayers;
    const confirmPins = !force && this.pinLayersNeedConfirm(bbox);
    if (confirmPins) this.store.setSearchHerePending(true);
    else if (force) this.store.setSearchHerePending(false);

    for (const layerId of Object.keys(active)) {
      const state = active[layerId];
      if (!state?.visible) continue;
      const managed = this.ensureAttached(layerId);
      if (!managed) continue;
      const expensive = viewportCostOf(managed.plugin) === "expensive";
      // An expensive layer waits to be asked ("Search here") rather than re-querying Overpass
      // on every pan; a cheap one just follows the map.
      if (!force && confirmPins && expensive) continue;
      void this.refreshOne(layerId, managed, bbox, state.filters, force && expensive);
    }
  }

  private async refreshOne(
    layerId: string,
    managed: ManagedLayer,
    bbox: Bbox,
    filters: FilterValues,
    markPinFetch = false
  ) {
    const mergedFilters = managed.plugin.deriveFilters?.(filters, this.runtimeContext()) ?? filters;
    const cacheKey = this.cache.key(layerId, bbox, mergedFilters);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      managed.handle.setData?.(cached);
      this.store.setVisibleFeatures(layerId, cached.features);
    } else {
      this.store.setLayerLoading(layerId, true);
    }

    this.abortControllers.get(layerId)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(layerId, controller);

    if (managed.plugin.reportsSourceStatus) {
      this.store.markSourcesLoading(this.store.enabledPoiSources);
    }

    try {
      const data = await managed.handle.update(bbox, mergedFilters, controller.signal);
      if (data) {
        this.cache.set(cacheKey, data);
        this.store.setVisibleFeatures(layerId, data.features);
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
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.warn(`Layer ${layerId} refresh failed:`, err);
      }
    } finally {
      if (this.abortControllers.get(layerId) === controller) {
        this.abortControllers.delete(layerId);
      }
      this.store.setLayerLoading(layerId, false);
    }
  }

  handlePinClick(layerId: string, feature: GeoFeature) {
    this.store.selectPin({ feature, layerId });
  }

  destroy() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
    for (const managed of this.managed.values()) {
      managed.handle.detach();
    }
    this.managed.clear();
  }
}

export async function fetchLayerFeatures(
  apiBase: string,
  layerId: string,
  bbox: Bbox,
  filters: FilterValues,
  signal?: AbortSignal
): Promise<FeatureCollection> {
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    ...Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])
    )
  });
  const res = await fetch(`${apiBase}/layers/${layerId}/features?${params}`, { signal });
  if (!res.ok) throw new Error(`Failed to fetch ${layerId}: ${res.status}`);
  return res.json() as Promise<FeatureCollection>;
}
