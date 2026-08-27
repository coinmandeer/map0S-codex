import type {
  Bbox,
  FilterValues,
  GeoFeature,
  LayerMode,
  MapViewState,
  PlaceSourceId,
  PlacesSourceMeta,
  ServerCapabilities
} from "@mapos/layer-sdk";
import { defaultPlaceSources } from "@mapos/layer-sdk";
import { getCountryMapConfig } from "../lib/countries";
import { emit } from "../lib/events";
import { initialLayerState, primaryLayerForMode } from "../layers";

export interface UserSession {
  id: string;
  email: string;
  displayName: string;
  /** Auto-created identity from `POST /auth/guest`. Real in every way the data model cares
   *  about — it owns pins, XP and quest progress — it just has no credentials yet. */
  isGuest: boolean;
  xpTotal: number;
}

export interface SelectedPin {
  feature: GeoFeature;
  layerId: string;
}

export interface RoutePreview {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  profile: "foot" | "bike" | "car";
}

export type SheetType = "pin" | "auth" | "edit" | "route" | "settings" | null;

export type ThemeMode = "light" | "dark";

/** Which upstream serves basemap tiles, geocoding and routing. POI sources are chosen
 *  separately via `poiSources` — Mapy.com is one contributor there, not a replacement. */
export type DataProvider = "osm" | "mapy";

export type SourceState = "idle" | "loading" | "ready" | "error";

/** Feature flags mirrored from `GET /config`: which optional upstreams the server has keys
 *  for. Used purely to disable UI that cannot work, never to carry a key to the client. */
export type { ServerCapabilities, LayerMode } from "@mapos/layer-sdk";
export type GameTrackingMode = "simulation" | "gps";
export type GameCameraMode = "follow" | "top";
export type PinKind = "place" | "route" | "task";

export interface MapState {
  view: MapViewState;
  activeLayers: Record<string, { visible: boolean; opacity: number; filters: FilterValues }>;
  selectedPin: SelectedPin | null;
  sheet: SheetType;
  sidebarOpen: boolean;
  activePresetId: string | null;
  session: UserSession | null;
  editMode: boolean;
  editLayerId: string | null;
  routePreview: RoutePreview | null;
  toast: string | null;
  mode: LayerMode;
  loadingLayers: Record<string, boolean>;
  layerNotices: Record<string, string>;
  visibleFeatures: Record<string, GeoFeature[]>;
  theme: ThemeMode;
  /** True when the map moved away from the last OSM fetch — show "Hledat zde". */
  searchHerePending: boolean;
  countryCode: string;
  activeTag: string | null;
  gameTrackingMode: GameTrackingMode;
  gameCameraMode: GameCameraMode;
  avatarStyle: "cube" | "aavegotchi";
  aavegotchiTokenId: string;
  dataProvider: DataProvider;
  /** Per-POI-source opt-in. Keys are `PLACE_SOURCES` ids from the layer SDK. */
  poiSources: Record<string, boolean>;
  /** Live fetch state per source, driving the SourceIconStrip loaders. */
  sourceStatus: Record<string, { state: SourceState; count?: number; message?: string }>;
  capabilities: ServerCapabilities | null;
}

const COUNTRY_STORAGE_KEY = "mapos:country";
const TAG_STORAGE_KEY = "mapos:active-tag";
const GAME_TRACKING_KEY = "mapos:game-tracking";
const GAME_CAMERA_KEY = "mapos:game-camera";
const AVATAR_STYLE_KEY = "mapos:avatar-style";
const GOTCHI_TOKEN_KEY = "mapos:gotchi-token";
const DATA_PROVIDER_KEY = "mapos:data-provider";
const POI_SOURCES_KEY = "mapos:poi-sources";

function loadDataProvider(): DataProvider {
  if (typeof window === "undefined") return "osm";
  return window.localStorage.getItem(DATA_PROVIDER_KEY) === "mapy" ? "mapy" : "osm";
}

function loadPoiSources(): Record<string, boolean> {
  const defaults = defaultPlaceSources();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(POI_SOURCES_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Merge over defaults so a source added in a later release starts at its default
    // rather than silently missing from an older stored object.
    for (const [key, value] of Object.entries(parsed)) {
      if (key in defaults && typeof value === "boolean") defaults[key as PlaceSourceId] = value;
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaults;
}

function loadCountryCode(): string {
  if (typeof window === "undefined") return "CZ";
  return window.localStorage.getItem(COUNTRY_STORAGE_KEY) ?? "CZ";
}

function loadActiveTag(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TAG_STORAGE_KEY);
}

function loadGameTracking(): GameTrackingMode {
  if (typeof window === "undefined") return "simulation";
  const v = window.localStorage.getItem(GAME_TRACKING_KEY);
  return v === "gps" ? "gps" : "simulation";
}

function loadGameCamera(): GameCameraMode {
  if (typeof window === "undefined") return "follow";
  const v = window.localStorage.getItem(GAME_CAMERA_KEY);
  return v === "top" ? "top" : "follow";
}

function loadAvatarStyle(): "cube" | "aavegotchi" {
  if (typeof window === "undefined") return "cube";
  return window.localStorage.getItem(AVATAR_STYLE_KEY) === "aavegotchi" ? "aavegotchi" : "cube";
}

function loadGotchiToken(): string {
  if (typeof window === "undefined") return "0";
  return window.localStorage.getItem(GOTCHI_TOKEN_KEY) ?? "0";
}

/** A layer's own defaults, plus the one thing the plugin can't know: which POI categories this
 *  particular user last had switched on. */
function initialStateFor(layerId: string) {
  const base = initialLayerState(layerId);
  if (layerId !== "osm-poi") return base;
  return { ...base, filters: { ...base.filters, categories: loadSavedCategories() } };
}

const CATS_STORAGE_KEY = "mapos:categories";
const PRESET_CATS_STORAGE_KEY = "mapos:preset-cats";
const LAST_PRESET_KEY = "mapos:last-preset";

export function loadSavedCategories(
  fallback: string[] = ["restaurant", "cafe", "parking", "viewpoint"]
): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(CATS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string"))
      return parsed as string[];
  } catch {
    /* ignore */
  }
  return fallback;
}

export function saveCategories(cats: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CATS_STORAGE_KEY, JSON.stringify(cats));
}

export function loadPresetCategories(presetId: string, fallback: string[]): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PRESET_CATS_STORAGE_KEY);
    if (!raw) return fallback;
    const all = JSON.parse(raw) as Record<string, string[]>;
    if (Array.isArray(all[presetId]) && all[presetId]!.length) return all[presetId]!;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function savePresetCategories(presetId: string, cats: string[]) {
  if (typeof window === "undefined") return;
  let all: Record<string, string[]>;
  try {
    all = JSON.parse(window.localStorage.getItem(PRESET_CATS_STORAGE_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
  } catch {
    all = {};
  }
  all[presetId] = cats;
  window.localStorage.setItem(PRESET_CATS_STORAGE_KEY, JSON.stringify(all));
  window.localStorage.setItem(LAST_PRESET_KEY, presetId);
  saveCategories(cats);
}

export function loadLastPresetId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_PRESET_KEY);
}

const DEFAULT_VIEW: MapViewState = { lng: 13.3775, lat: 49.7475, zoom: 12 };

function isValidView(lng: number, lat: number, zoom: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Number.isFinite(zoom) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 85 &&
    // Reject corrupt 0/0/0 state written by a zero-height map init
    !(lng === 0 && lat === 0) &&
    zoom >= 1 &&
    zoom <= 22
  );
}

const VALID_MODES: LayerMode[] = ["poi", "weather", "game", "mine", "discover"];
const THEME_STORAGE_KEY = "mapos:theme";

function loadInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function parseUrlState(): { view: MapViewState; layers: string[]; mode: LayerMode } {
  const params = new URLSearchParams(window.location.search);
  const lng = Number(params.get("lng"));
  const lat = Number(params.get("lat"));
  const zoom = Number(params.get("z"));
  const layers = params.get("layers")?.split(",").filter(Boolean) ?? [];
  const modeParam = params.get("mode");
  const mode = VALID_MODES.includes(modeParam as LayerMode) ? (modeParam as LayerMode) : "poi";
  const view = isValidView(lng, lat, zoom) ? { lng, lat, zoom } : { ...DEFAULT_VIEW };
  return { view, layers, mode };
}

type Listener = () => void;

export class MapStore {
  private listeners = new Set<Listener>();
  state: MapState;

  constructor() {
    const { view, layers, mode } = parseUrlState();
    const activeLayers: MapState["activeLayers"] = {};
    for (const id of layers) {
      activeLayers[id] = { visible: true, opacity: 1, filters: {} };
    }
    this.state = {
      view,
      activeLayers,
      selectedPin: null,
      sheet: null,
      sidebarOpen:
        (typeof window !== "undefined" && window.innerWidth >= 900) || mode === "discover",
      activePresetId: loadLastPresetId(),
      session: null,
      editMode: false,
      editLayerId: null,
      routePreview: null,
      toast: null,
      mode,
      loadingLayers: {},
      layerNotices: {},
      visibleFeatures: {},
      theme: loadInitialTheme(),
      searchHerePending: false,
      countryCode: loadCountryCode(),
      activeTag: loadActiveTag(),
      gameTrackingMode: loadGameTracking(),
      gameCameraMode: loadGameCamera(),
      avatarStyle: loadAvatarStyle(),
      aavegotchiTokenId: loadGotchiToken(),
      dataProvider: loadDataProvider(),
      poiSources: loadPoiSources(),
      sourceStatus: {},
      capabilities: null
    };

    // Activate the mode's primary layer on first load when URL didn't list any layers.
    const primary = primaryLayerForMode(mode);
    if (!this.state.activeLayers[primary]?.visible) {
      this.state.activeLayers[primary] = initialStateFor(primary);
    } else if (primary === "osm-poi" && !this.state.activeLayers["osm-poi"]!.filters?.categories) {
      this.state.activeLayers["osm-poi"]!.filters = { categories: loadSavedCategories() };
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Wakes up React subscribers. Distinct from the imported `emit`, which broadcasts an
   *  application-wide signal to modules that don't subscribe to the store at all. */
  private notify() {
    for (const l of this.listeners) l();
  }

  private patch(partial: Partial<MapState>) {
    Object.assign(this.state, partial);
    this.notify();
  }

  get view() {
    return this.state.view;
  }
  get activeLayers() {
    return this.state.activeLayers;
  }
  get selectedPin() {
    return this.state.selectedPin;
  }
  get sheet() {
    return this.state.sheet;
  }
  get sidebarOpen() {
    return this.state.sidebarOpen;
  }
  get activePresetId() {
    return this.state.activePresetId;
  }
  get session() {
    return this.state.session;
  }
  get editMode() {
    return this.state.editMode;
  }
  get editLayerId() {
    return this.state.editLayerId;
  }
  get routePreview() {
    return this.state.routePreview;
  }
  get toast() {
    return this.state.toast;
  }
  get mode() {
    return this.state.mode;
  }
  get loadingLayers() {
    return this.state.loadingLayers;
  }
  get layerNotices() {
    return this.state.layerNotices;
  }
  get visibleFeatures() {
    return this.state.visibleFeatures;
  }
  get theme() {
    return this.state.theme;
  }
  get searchHerePending() {
    return this.state.searchHerePending;
  }
  get countryCode() {
    return this.state.countryCode;
  }
  get activeTag() {
    return this.state.activeTag;
  }
  get gameTrackingMode() {
    return this.state.gameTrackingMode;
  }
  get gameCameraMode() {
    return this.state.gameCameraMode;
  }
  get avatarStyle() {
    return this.state.avatarStyle;
  }
  get aavegotchiTokenId() {
    return this.state.aavegotchiTokenId;
  }
  get dataProvider() {
    return this.state.dataProvider;
  }
  get poiSources() {
    return this.state.poiSources;
  }
  get sourceStatus() {
    return this.state.sourceStatus;
  }
  get capabilities() {
    return this.state.capabilities;
  }

  /** Sources the user has enabled AND the server actually has credentials for. */
  get enabledPoiSources(): PlaceSourceId[] {
    return Object.entries(this.state.poiSources)
      .filter(([, on]) => on)
      .map(([id]) => id as PlaceSourceId);
  }

  setDataProvider(provider: DataProvider) {
    if (this.state.dataProvider === provider) return;
    this.state.dataProvider = provider;
    window.localStorage.setItem(DATA_PROVIDER_KEY, provider);
    this.notify();
    emit("provider-changed", { provider });
    emit("search-here");
  }

  setPoiSource(source: PlaceSourceId, enabled: boolean) {
    this.state.poiSources = { ...this.state.poiSources, [source]: enabled };
    window.localStorage.setItem(POI_SOURCES_KEY, JSON.stringify(this.state.poiSources));
    this.notify();
    emit("layers-changed");
    emit("search-here");
  }

  setSourceStatus(status: MapState["sourceStatus"]) {
    this.patch({ sourceStatus: status });
  }

  /** Flips the requested sources to "loading" while keeping their last known counts, so the
   *  icon strip shows a progress ring over the previous number instead of blanking out. */
  markSourcesLoading(sources: PlaceSourceId[]) {
    const next = { ...this.state.sourceStatus };
    for (const source of sources) {
      next[source] = { ...next[source], state: "loading" };
    }
    this.patch({ sourceStatus: next });
  }

  applySourceMeta(metas: PlacesSourceMeta[]) {
    const next: MapState["sourceStatus"] = {};
    for (const meta of metas) {
      next[meta.source] = {
        state: meta.state === "ready" ? "ready" : meta.state === "error" ? "error" : "idle",
        count: meta.count,
        message: meta.message
      };
    }
    this.patch({ sourceStatus: next });
  }

  setCapabilities(capabilities: ServerCapabilities) {
    // A provider the server has no key for must not stay selected, or every request
    // silently 503s with no way for the user to tell why.
    const provider =
      !capabilities.mapy && this.state.dataProvider === "mapy" ? "osm" : this.state.dataProvider;
    this.patch({ capabilities, dataProvider: provider });
  }

  setSearchHerePending(pending: boolean) {
    if (this.state.searchHerePending === pending) return;
    this.patch({ searchHerePending: pending });
  }

  setView(partial: Partial<MapViewState>) {
    this.state.view = { ...this.state.view, ...partial };
    this.syncToUrl();
    this.notify();
  }

  toggleLayer(layerId: string) {
    const current = this.state.activeLayers[layerId];
    if (current?.visible) {
      const { [layerId]: _removed, ...rest } = this.state.activeLayers;
      this.state.activeLayers = rest;
    } else {
      const initial = initialStateFor(layerId);
      this.state.activeLayers = {
        ...this.state.activeLayers,
        // Filters the user already chose survive toggling the layer off and back on.
        [layerId]: { ...initial, filters: current?.filters ?? initial.filters }
      };
    }
    this.state.activePresetId = null;
    this.syncToUrl();
    this.notify();
    emit("layers-changed");
  }

  setSidebarOpen(open: boolean) {
    this.patch({ sidebarOpen: open });
  }

  togglePanel() {
    this.setSidebarOpen(!this.state.sidebarOpen);
  }

  private ensureLayerActive(layerId: string) {
    if (!this.state.activeLayers[layerId]?.visible) {
      this.state.activeLayers = {
        ...this.state.activeLayers,
        [layerId]: initialStateFor(layerId)
      };
    }
  }

  /** Replaces one layer's entry and the containing map with fresh objects.
   *
   *  This is load-bearing rather than stylistic: `useMapStoreSnapshot` selects through
   *  `useSyncExternalStore`, which compares snapshots with `Object.is`. Mutating an entry in
   *  place leaves both the entry and `activeLayers` referentially identical, so React concludes
   *  nothing changed and skips the render — the map updates, the controls driving it do not. */
  private patchLayer(
    layerId: string,
    patch: Partial<{ visible: boolean; opacity: number; filters: FilterValues }>
  ) {
    const entry = this.state.activeLayers[layerId];
    if (!entry) return;
    this.state.activeLayers = {
      ...this.state.activeLayers,
      [layerId]: { ...entry, ...patch }
    };
  }

  setMode(mode: LayerMode) {
    this.state.mode = mode;
    this.ensureLayerActive(primaryLayerForMode(mode));
    if (mode === "discover") this.state.sidebarOpen = true;
    this.syncToUrl();
    this.notify();
    emit("mode-changed", { mode });
    emit("layers-changed");
  }

  setCountry(code: string) {
    const next = code.toUpperCase();
    if (this.state.countryCode === next) return;
    this.state.countryCode = next;
    window.localStorage.setItem(COUNTRY_STORAGE_KEY, next);
    this.notify();
    emit("country-changed", { countryCode: next });
    if (next !== "ALL") {
      const cfg = getCountryMapConfig(next);
      emit("fly-to", { lng: cfg.centerLng, lat: cfg.centerLat, zoom: 7 });
      this.setView({ lng: cfg.centerLng, lat: cfg.centerLat, zoom: 7 });
      emit("search-here");
    }
  }

  setActiveTag(tag: string | null) {
    const normalized = tag?.trim().toLowerCase() || null;
    this.state.activeTag = normalized;
    if (normalized) window.localStorage.setItem(TAG_STORAGE_KEY, normalized);
    else window.localStorage.removeItem(TAG_STORAGE_KEY);
    this.notify();
    emit("tag-changed", { tag: normalized });
    emit("search-here");
  }

  setGameTrackingMode(mode: GameTrackingMode) {
    this.state.gameTrackingMode = mode;
    window.localStorage.setItem(GAME_TRACKING_KEY, mode);
    this.notify();
    emit("game-tracking-changed", { mode });
  }

  setGameCameraMode(mode: GameCameraMode) {
    this.state.gameCameraMode = mode;
    window.localStorage.setItem(GAME_CAMERA_KEY, mode);
    this.notify();
    emit("game-camera-changed", { mode });
  }

  setAvatarStyle(style: "cube" | "aavegotchi", tokenId?: string) {
    this.state.avatarStyle = style;
    window.localStorage.setItem(AVATAR_STYLE_KEY, style);
    if (tokenId != null) {
      this.state.aavegotchiTokenId = tokenId;
      window.localStorage.setItem(GOTCHI_TOKEN_KEY, tokenId);
    }
    this.notify();
    emit("avatar-changed", { style, tokenId: this.state.aavegotchiTokenId });
  }

  setTheme(theme: ThemeMode) {
    if (theme === this.state.theme) return;
    this.state.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    this.notify();
    emit("theme-changed", { theme });
  }

  toggleTheme() {
    this.setTheme(this.state.theme === "dark" ? "light" : "dark");
  }

  setLayerLoading(layerId: string, loading: boolean) {
    const next = { ...this.state.loadingLayers };
    if (loading) next[layerId] = true;
    else delete next[layerId];
    this.patch({ loadingLayers: next });
  }

  /** Why a layer came back empty on purpose — "zoom in", "source is down". Cleared as soon as
   *  the layer returns something, so a stale explanation never outlives its cause. */
  setLayerNotice(layerId: string, notice: string | undefined) {
    if (this.state.layerNotices[layerId] === notice) return;
    const next = { ...this.state.layerNotices };
    if (notice) next[layerId] = notice;
    else delete next[layerId];
    this.patch({ layerNotices: next });
  }

  setVisibleFeatures(layerId: string, features: GeoFeature[]) {
    this.patch({ visibleFeatures: { ...this.state.visibleFeatures, [layerId]: features } });
  }

  applyPreset(preset: { id: string; layers: string[]; categories?: string[] }) {
    const cats =
      preset.categories && preset.categories.length
        ? loadPresetCategories(preset.id, preset.categories)
        : undefined;
    if (cats) savePresetCategories(preset.id, cats);
    const next: MapState["activeLayers"] = {};
    for (const layerId of preset.layers) {
      const initial = initialLayerState(layerId);
      // A usecase picks the categories; everything else the layer decides for itself.
      next[layerId] =
        layerId === "osm-poi" && cats
          ? { ...initial, filters: { ...initial.filters, categories: cats } }
          : initial;
    }
    this.state.activeLayers = next;
    this.state.activePresetId = preset.id;
    this.state.searchHerePending = false;
    this.syncToUrl();
    this.notify();
    emit("layers-changed");
    emit("search-here");
  }

  setLayerOpacity(layerId: string, opacity: number) {
    this.patchLayer(layerId, { opacity });
    this.notify();
    emit("layers-changed");
  }

  setLayerFilters(layerId: string, filters: FilterValues) {
    this.patchLayer(layerId, { filters });
    if (layerId === "osm-poi" && Array.isArray(filters.categories)) {
      saveCategories(filters.categories as string[]);
      if (this.state.activePresetId) {
        savePresetCategories(this.state.activePresetId, filters.categories as string[]);
      }
    }
    this.notify();
    emit("layers-changed");
    emit("search-here");
  }

  selectPin(pin: SelectedPin | null) {
    this.patch({ selectedPin: pin, sheet: pin ? "pin" : null });
  }

  openSheet(sheet: SheetType) {
    this.patch({ sheet });
  }

  closeSheet() {
    this.patch({ sheet: null, selectedPin: null });
  }

  setSession(session: UserSession | null) {
    this.patch({ session });
  }

  setEditMode(enabled: boolean, layerId: string | null = null) {
    this.patch({ editMode: enabled, editLayerId: layerId, sheet: enabled ? "edit" : null });
  }

  setRoutePreview(route: RoutePreview | null) {
    this.patch({ routePreview: route, sheet: route ? "route" : null });
  }

  showToast(message: string) {
    this.patch({ toast: message });
    setTimeout(() => this.patch({ toast: null }), 3000);
  }

  syncToUrl() {
    const params = new URLSearchParams();
    params.set("lng", this.state.view.lng.toFixed(5));
    params.set("lat", this.state.view.lat.toFixed(5));
    params.set("z", this.state.view.zoom.toFixed(1));
    params.set("mode", this.state.mode);
    const active = Object.entries(this.state.activeLayers)
      .filter(([, s]) => s.visible)
      .map(([id]) => id);
    if (active.length) params.set("layers", active.join(","));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }
}

let storeInstance: MapStore | null = null;

/** Not a React hook: the store is a plain singleton and reading it does not subscribe to
 *  anything. Components that need to re-render on change use `useMapStoreSnapshot` instead. */
export function getMapStore(): MapStore {
  if (!storeInstance) storeInstance = new MapStore();
  return storeInstance;
}

export function getMapBbox(map: maplibregl.Map): Bbox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

import type maplibregl from "maplibre-gl";
