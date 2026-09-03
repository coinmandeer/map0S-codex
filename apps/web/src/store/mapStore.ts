import type {
  Bbox,
  ExperienceId,
  FilterValues,
  GeoFeature,
  LayerModeV2,
  MapViewState,
  PlaceSourceId,
  PlacesSourceMeta,
  PlanDocumentV2,
  ServerCapabilities,
  TemporalState,
  TripPlan,
  TripTravelProfile
} from "@mapos/layer-sdk";
import {
  assertPlanDocumentV2,
  basemapById,
  DEFAULT_BASEMAP_ID,
  defaultPlaceSources,
  planV1ToV2,
  planV2ToV1
} from "@mapos/layer-sdk";
import { getCountryMapConfig } from "../lib/countries";
import { emit } from "../lib/events";
import { initialLayerState, primaryLayerForMode } from "../layers";
import {
  legacyLayerModeFor,
  resolveAppMode,
  type AppModeInput,
  type AppModeResolution
} from "../product/registry";
import { readLayerSessionState, writeLayerSessionState } from "./layerSessionState";
import {
  loadUserPreferences,
  persistUserPreferences,
  resolveThemePreference,
  type ThemePreference,
  type UserPreferences
} from "../settings/preferences";

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
  profile: TripTravelProfile;
  segments?: Array<{
    id: string;
    order: number;
    coordinates: [number, number][];
    distanceM: number;
    durationS: number;
  }>;
  /** Variants the user has not chosen, drawn dimmed and clickable so a segment can be swapped
   *  from the map instead of the itinerary (§16.6). */
  alternatives?: Array<{
    segmentId: string;
    alternativeId: string;
    coordinates: [number, number][];
  }>;
  stops?: Array<{
    coordinates: [number, number];
    order: number;
    name: string;
  }>;
}

export type SheetType =
  "pin" | "auth" | "edit" | "route" | "settings" | "basemap" | "tiles" | "wizard" | null;

export type ThemeMode = "light" | "dark";

/** Which upstream serves basemap tiles, geocoding and routing. POI sources are chosen
 *  separately via `poiSources` — Mapy.com is one contributor there, not a replacement. */
export type DataProvider = "osm" | "mapy";

export type SourceState = "idle" | "loading" | "ready" | "error";

/** Feature flags mirrored from `GET /config`: which optional upstreams the server has keys
 *  for. Used purely to disable UI that cannot work, never to carry a key to the client. */
export type { ServerCapabilities } from "@mapos/layer-sdk";
/** Compatibility name for web callers; shell state now uses the canonical v2 four-mode union. */
export type LayerMode = LayerModeV2;
export type GameTrackingMode = "simulation" | "gps";
export type GameCameraMode = "follow" | "top";
export type PinKind = "place" | "route" | "task";

/** A toast is one line plus at most one action — the undo for something the app just did on
 *  the user's behalf (§4.14). */
export interface ToastState {
  message: string;
  action?: { label: string; onSelect: () => void };
}

export interface ToastOptions {
  durationMs?: number;
  action?: ToastState["action"];
}

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
  /** A real adjacent route segment chosen on the map or in the planning result list. */
  selectedRouteSegmentId: string | null;
  activePlan: TripPlan | null;
  /** Canonical planning state; activePlan stays as a v1 projection for older panels. */
  activePlanDocument: PlanDocumentV2 | null;
  toast: ToastState | null;
  mode: LayerModeV2;
  loadingLayers: Record<string, boolean>;
  layerNotices: Record<string, string>;
  visibleFeatures: Record<string, GeoFeature[]>;
  /** Effective light/dark value consumed by the renderer. */
  theme: ThemeMode;
  /** Versioned user choices, including a possible system-driven theme. */
  preferences: UserPreferences;
  experienceId: ExperienceId;
  temporal: TemporalState;
  /** True when the map moved away from the last OSM fetch — show "Hledat zde". */
  searchHerePending: boolean;
  countryCode: string;
  activeTag: string | null;
  gameTrackingMode: GameTrackingMode;
  gameCameraMode: GameCameraMode;
  avatarStyle: "cube" | "aavegotchi";
  aavegotchiTokenId: string;
  activeGameIds: string[];
  focusedGameId: string;
  dataProvider: DataProvider;
  /** The chosen map background. Exactly one, from the SDK's basemap catalogue — deliberately
   *  separate from `dataProvider` and `poiSources`, so tiles from one company can be compared
   *  against places from another. */
  basemapId: string;
  /** Draw place names over aerial imagery. No effect on backgrounds that have their own. */
  basemapLabels: boolean;
  /** Extrude buildings on backgrounds whose data carries heights. */
  buildings3d: boolean;
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
const AVATAR_STYLE_MIGRATION_KEY = "mapos:avatar-aavegotchi-default-v1";
const GOTCHI_TOKEN_KEY = "mapos:gotchi-token";
const DATA_PROVIDER_KEY = "mapos:data-provider";
const POI_SOURCES_KEY = "mapos:poi-sources";
const BASEMAP_KEY = "mapos:basemap";
const BASEMAP_LABELS_KEY = "mapos:basemap-labels";
const BUILDINGS_3D_KEY = "mapos:buildings-3d";
const EXPERIENCE_KEY = "mapos:experience";
const ACTIVE_GAMES_KEY = "mapos:active-games";
const ACTIVE_PLAN_KEY = "mapos:active-plan";
const ACTIVE_PLAN_DOCUMENT_KEY = "mapos:active-plan-v2";

function loadExperience(): ExperienceId {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem(EXPERIENCE_KEY) === "aavegotchi" ? "aavegotchi" : "default";
}

function loadActiveGames(): string[] {
  if (typeof window === "undefined") return ["aavegotchi"];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_GAMES_KEY) ?? "[]") as unknown;
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string") && parsed.length) {
      return [...new Set(parsed)];
    }
  } catch {
    /* Keep the built-in game available when stored state is malformed. */
  }
  return ["aavegotchi"];
}

function loadActivePlan(): TripPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_PLAN_KEY) ?? "null") as TripPlan;
    if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.stops)) return parsed;
  } catch {
    /* A corrupt local draft must never prevent the map from opening. */
  }
  return null;
}

function loadActivePlanDocument(legacy: TripPlan | null): PlanDocumentV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ACTIVE_PLAN_DOCUMENT_KEY) ?? "null"
    ) as unknown;
    assertPlanDocumentV2(parsed);
    return parsed;
  } catch {
    if (!legacy) return null;
    try {
      return planV1ToV2(legacy, {
        now: legacy.updatedAt ?? legacy.createdAt ?? legacy.departureAt
      });
    } catch {
      return null;
    }
  }
}

function initialTemporalState(): TemporalState {
  const now = new Date();
  return {
    cursor: now.toISOString(),
    mode: "live",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    rangeStart: new Date(now.getTime() - 24 * 3600_000).toISOString(),
    rangeEnd: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString()
  };
}

function loadDataProvider(): DataProvider {
  if (typeof window === "undefined") return "osm";
  return window.localStorage.getItem(DATA_PROVIDER_KEY) === "mapy" ? "mapy" : "osm";
}

function loadBasemapId(): string {
  if (typeof window === "undefined") return DEFAULT_BASEMAP_ID;
  const stored = window.localStorage.getItem(BASEMAP_KEY);
  if (stored && basemapById(stored)) return stored;
  // Before backgrounds were selectable, picking Mapy as the data provider also swapped the
  // tiles. Anyone who did that keeps the map they had.
  if (window.localStorage.getItem(DATA_PROVIDER_KEY) === "mapy") return "mapy-outdoor";
  return DEFAULT_BASEMAP_ID;
}

function loadFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === "1";
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
  if (typeof window === "undefined") return "aavegotchi";
  // Earlier prototypes silently persisted the generic 3D character as the default. Migrate that
  // once so the Aavegotchi game finally looks like Aavegotchi, while still respecting a later
  // explicit switch back to the generic character.
  if (!window.localStorage.getItem(AVATAR_STYLE_MIGRATION_KEY)) {
    window.localStorage.setItem(AVATAR_STYLE_MIGRATION_KEY, "1");
    window.localStorage.setItem(AVATAR_STYLE_KEY, "aavegotchi");
    return "aavegotchi";
  }
  return window.localStorage.getItem(AVATAR_STYLE_KEY) === "cube" ? "cube" : "aavegotchi";
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

/** Privacy-safe first run: Europe overview, never an invented precise user position. A real device
 * location is requested only after the explicit "Moje poloha" action. */
const DEFAULT_VIEW: MapViewState = { lng: 10.2, lat: 51, zoom: 4 };

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

const THEME_STORAGE_KEY = "mapos:theme";

function prefersDarkScheme(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export interface ParsedUrlState {
  view: MapViewState;
  layers: string[];
  modeResolution: AppModeResolution;
}

export function parseUrlState(
  search = typeof window === "undefined" ? "" : window.location.search
): ParsedUrlState {
  const params = new URLSearchParams(search);
  const lng = Number(params.get("lng"));
  const lat = Number(params.get("lat"));
  const zoom = Number(params.get("z"));
  const layers = params.get("layers")?.split(",").filter(Boolean) ?? [];
  const modeResolution = resolveAppMode(params.get("mode"));
  const view = isValidView(lng, lat, zoom) ? { lng, lat, zoom } : { ...DEFAULT_VIEW };
  return { view, layers, modeResolution };
}

type Listener = () => void;

/** How long a toast stays up. Long enough to read a sentence, short enough not to sit over the map. */
export const TOAST_MS = 4000;

export class MapStore {
  private listeners = new Set<Listener>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  state: MapState;

  constructor() {
    const { view, layers, modeResolution } = parseUrlState();
    const { mode } = modeResolution;
    const activeLayers: MapState["activeLayers"] = {};
    const layerSession = readLayerSessionState(
      typeof window === "undefined" ? null : window.sessionStorage
    );
    const legacyActivePlan = loadActivePlan();
    const activePlanDocument = loadActivePlanDocument(legacyActivePlan);
    const preferences = loadUserPreferences(
      typeof window === "undefined" ? null : window.localStorage,
      typeof window === "undefined" ? null : window.localStorage.getItem(THEME_STORAGE_KEY)
    );
    for (const id of layers.length ? layers : Object.keys(layerSession)) {
      activeLayers[id] = layerSession[id] ?? { visible: true, opacity: 1, filters: {} };
    }
    this.state = {
      view,
      activeLayers,
      selectedPin: null,
      sheet: null,
      // Every mode owns a panel, and on a phone that panel is the bottom sheet, which opens at
      // the snap §21.2 gives it. Leaving it closed on load was why `?mode=planning` showed a
      // bare handle under the top bar on mobile (§29.2/4).
      sidebarOpen: true,
      activePresetId: loadLastPresetId(),
      session: null,
      editMode: false,
      editLayerId: null,
      routePreview: null,
      selectedRouteSegmentId: null,
      activePlan: activePlanDocument ? planV2ToV1(activePlanDocument) : legacyActivePlan,
      activePlanDocument,
      toast: null,
      mode,
      loadingLayers: {},
      layerNotices: {},
      visibleFeatures: {},
      theme: resolveThemePreference(preferences.theme, prefersDarkScheme()),
      preferences,
      experienceId: loadExperience(),
      temporal: initialTemporalState(),
      searchHerePending: false,
      countryCode: loadCountryCode(),
      activeTag: loadActiveTag(),
      gameTrackingMode: loadGameTracking(),
      gameCameraMode: loadGameCamera(),
      avatarStyle: loadAvatarStyle(),
      aavegotchiTokenId: loadGotchiToken(),
      activeGameIds: loadActiveGames(),
      focusedGameId: "aavegotchi",
      dataProvider: loadDataProvider(),
      basemapId: loadBasemapId(),
      basemapLabels: loadFlag(BASEMAP_LABELS_KEY, true),
      buildings3d: loadFlag(BUILDINGS_3D_KEY, false),
      poiSources: loadPoiSources(),
      sourceStatus: {},
      capabilities: null
    };

    // Activate the mode's primary layer on first load when URL didn't list any layers.
    const primary = primaryLayerForMode(legacyLayerModeFor(mode));
    if (!this.state.activeLayers[primary]?.visible) {
      this.state.activeLayers[primary] = initialStateFor(primary);
    } else if (primary === "osm-poi" && !this.state.activeLayers["osm-poi"]!.filters?.categories) {
      this.state.activeLayers["osm-poi"]!.filters = { categories: loadSavedCategories() };
    }
    if (modeResolution.activateLayerId) {
      this.ensureLayerActive(modeResolution.activateLayerId);
    }
    this.persistLayerSession();
    if (modeResolution.rewriteUrl && typeof window !== "undefined") {
      this.syncToUrl();
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
  get selectedRouteSegmentId() {
    return this.state.selectedRouteSegmentId;
  }
  get activePlan() {
    return this.state.activePlan;
  }
  get activePlanDocument() {
    return this.state.activePlanDocument;
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
  get preferences() {
    return this.state.preferences;
  }
  get experienceId() {
    return this.state.experienceId;
  }
  get temporal() {
    return this.state.temporal;
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
  get activeGameIds() {
    return this.state.activeGameIds;
  }
  get focusedGameId() {
    return this.state.focusedGameId;
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

  get basemapId() {
    return this.state.basemapId;
  }
  get basemapLabels() {
    return this.state.basemapLabels;
  }
  get buildings3d() {
    return this.state.buildings3d;
  }

  setBasemap(id: string) {
    if (this.state.basemapId === id || !basemapById(id)) return;
    this.state.basemapId = id;
    window.localStorage.setItem(BASEMAP_KEY, id);
    this.notify();
    emit("basemap-changed", { basemapId: id });
  }

  setBasemapLabels(enabled: boolean) {
    if (this.state.basemapLabels === enabled) return;
    this.state.basemapLabels = enabled;
    window.localStorage.setItem(BASEMAP_LABELS_KEY, enabled ? "1" : "0");
    this.notify();
    emit("basemap-changed", { basemapId: this.state.basemapId });
  }

  setBuildings3d(enabled: boolean) {
    if (this.state.buildings3d === enabled) return;
    this.state.buildings3d = enabled;
    window.localStorage.setItem(BUILDINGS_3D_KEY, enabled ? "1" : "0");
    this.notify();
    emit("buildings-3d-changed", { enabled });
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
    // Same for the background: a stored choice can outlive the key it needed, and an unpainted
    // map is worse than a different one.
    const needed = basemapById(this.state.basemapId)?.requiresCapability;
    const basemapId = needed && !capabilities[needed] ? DEFAULT_BASEMAP_ID : this.state.basemapId;
    const swapped = basemapId !== this.state.basemapId;
    this.patch({ capabilities, dataProvider: provider, basemapId });
    if (swapped) emit("basemap-changed", { basemapId });
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
    this.persistLayerSession();
    this.syncToUrl();
    this.notify();
    emit("layers-changed");
  }

  /** Releases the preset badge without touching the layers it switched on. Tapping the active
   *  preset again means "stop calling this a preset", not "undo my map". */
  clearPreset() {
    if (this.state.activePresetId === null) return;
    this.state.activePresetId = null;
    if (typeof window !== "undefined") window.localStorage.removeItem(LAST_PRESET_KEY);
    this.persistLayerSession();
    this.syncToUrl();
    this.notify();
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

  private persistLayerSession() {
    writeLayerSessionState(
      typeof window === "undefined" ? null : window.sessionStorage,
      this.state.activeLayers
    );
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

  setMode(input: AppModeInput) {
    const { mode, activateLayerId } = resolveAppMode(input);
    const previousMode = this.state.mode;
    this.state.mode = mode;
    // The game owns a continuously rendered WebGL scene, not a passive map overlay. Keeping it in
    // the shared layer stack after its HUD has gone means Three.js keeps drawing forever while the
    // user is back in the ordinary map. Other overlays intentionally survive navigation, but the
    // game must be detached when its mode is left so LayerEngine can run its full cleanup.
    if (previousMode === "game" && mode !== "game" && this.state.activeLayers.game) {
      const { game: _game, ...rest } = this.state.activeLayers;
      this.state.activeLayers = rest;
    }
    this.ensureLayerActive(primaryLayerForMode(legacyLayerModeFor(mode)));
    if (activateLayerId) this.ensureLayerActive(activateLayerId);
    // Every canonical mode owns the same left context surface. GameHud is no longer a detached
    // overlay; users can close the panel to maximise the board without remounting the map.
    this.state.sidebarOpen = true;
    this.persistLayerSession();
    this.syncToUrl();
    this.notify();
    emit("mode-changed", { mode });
    emit("layers-changed");
  }

  setExperience(id: ExperienceId) {
    if (id === this.state.experienceId) return;
    this.state.experienceId = id;
    window.localStorage.setItem(EXPERIENCE_KEY, id);
    if (id === "aavegotchi") {
      this.state.avatarStyle = "aavegotchi";
      window.localStorage.setItem(AVATAR_STYLE_KEY, "aavegotchi");
      if (!this.state.activeGameIds.includes("aavegotchi")) {
        this.state.activeGameIds = [...this.state.activeGameIds, "aavegotchi"];
        window.localStorage.setItem(ACTIVE_GAMES_KEY, JSON.stringify(this.state.activeGameIds));
      }
    }
    this.notify();
    emit("experience-changed", { id });
    emit("avatar-changed", {
      style: this.state.avatarStyle,
      tokenId: this.state.aavegotchiTokenId
    });
  }

  setTimeCursor(cursor: string | Date, mode: TemporalState["mode"] = "preview") {
    const date = cursor instanceof Date ? cursor : new Date(cursor);
    if (!Number.isFinite(date.getTime())) return;
    this.state.temporal = { ...this.state.temporal, cursor: date.toISOString(), mode };
    this.notify();
    emit("time-changed", { temporal: this.state.temporal });
  }

  setTimeLive() {
    this.setTimeCursor(new Date(), "live");
  }

  setActiveGames(ids: string[], focusedId?: string) {
    const unique = [...new Set(ids.filter(Boolean))];
    this.state.activeGameIds = unique;
    this.state.focusedGameId =
      focusedId && unique.includes(focusedId) ? focusedId : (unique[0] ?? "aavegotchi");
    window.localStorage.setItem(ACTIVE_GAMES_KEY, JSON.stringify(unique));
    this.notify();
    emit("games-changed", {
      activeGameIds: unique,
      focusedGameId: this.state.focusedGameId
    });
  }

  setFocusedGame(id: string) {
    if (!this.state.activeGameIds.includes(id) || this.state.focusedGameId === id) return;
    this.state.focusedGameId = id;
    this.notify();
    emit("games-changed", { activeGameIds: this.state.activeGameIds, focusedGameId: id });
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

  setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    if (key === "theme") {
      this.setThemePreference(value as ThemePreference);
      return;
    }
    if (Object.is(this.state.preferences[key], value)) return;
    this.state.preferences = { ...this.state.preferences, [key]: value };
    persistUserPreferences(window.localStorage, this.state.preferences);
    this.notify();
  }

  setThemePreference(preference: ThemePreference) {
    const theme = resolveThemePreference(preference, prefersDarkScheme());
    if (this.state.preferences.theme === preference && this.state.theme === theme) return;
    this.state.preferences = { ...this.state.preferences, theme: preference };
    this.state.theme = theme;
    persistUserPreferences(window.localStorage, this.state.preferences);
    // Retain the old key during the migration window for older rollback bundles.
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    this.notify();
    emit("theme-changed", { theme });
  }

  applySystemTheme(prefersDark: boolean) {
    if (this.state.preferences.theme !== "system") return;
    const theme = resolveThemePreference("system", prefersDark);
    if (theme === this.state.theme) return;
    this.state.theme = theme;
    this.notify();
    emit("theme-changed", { theme });
  }

  setTheme(theme: ThemeMode) {
    this.setThemePreference(theme);
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
    const next: MapState["activeLayers"] = { ...this.state.activeLayers };
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
    this.persistLayerSession();
    this.syncToUrl();
    this.notify();
    emit("layers-changed");
    emit("search-here");
  }

  setLayerOpacity(layerId: string, opacity: number) {
    this.patchLayer(layerId, { opacity });
    this.persistLayerSession();
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
      // Manual category edits remain fully supported after applying a preset, but the preset
      // cannot still claim to be an unchanged canned selection.
      this.state.activePresetId = null;
      if (typeof window !== "undefined") window.localStorage.removeItem(LAST_PRESET_KEY);
    }
    this.persistLayerSession();
    this.notify();
    emit("layers-changed");
    emit("search-here");
  }

  /** §4.10: a selected pin is a left-panel context, not a modal, so selecting one no longer
   *  claims the single sheet slot — the shell opens the detail panel from `selectedPin`. */
  selectPin(pin: SelectedPin | null) {
    this.patch({ selectedPin: pin, sheet: this.state.sheet === "pin" ? null : this.state.sheet });
  }

  openSheet(sheet: SheetType) {
    this.patch({ sheet });
  }

  closeSheet() {
    this.patch({ sheet: null, selectedPin: null });
  }

  setSession(session: UserSession | null) {
    this.patch({ session });
    emit("session-changed", { userId: session?.id ?? null, xpTotal: session?.xpTotal ?? 0 });
  }

  setEditMode(enabled: boolean, layerId: string | null = null) {
    this.patch({ editMode: enabled, editLayerId: layerId, sheet: enabled ? "edit" : null });
  }

  setRoutePreview(route: RoutePreview | null, openSummary = true) {
    const selectedRouteSegmentId = route?.segments?.some(
      (segment) => segment.id === this.state.selectedRouteSegmentId
    )
      ? this.state.selectedRouteSegmentId
      : null;
    this.patch({
      routePreview: route,
      selectedRouteSegmentId,
      sheet: route && openSummary ? "route" : null
    });
  }

  selectRouteSegment(segmentId: string | null) {
    if (
      segmentId &&
      !this.state.routePreview?.segments?.some((segment) => segment.id === segmentId)
    ) {
      return;
    }
    this.patch({ selectedRouteSegmentId: segmentId });
  }

  setActivePlan(plan: TripPlan | null) {
    this.state.activePlan = plan;
    if (plan) {
      window.localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(plan));
      try {
        const document = planV1ToV2(plan, {
          now: plan.updatedAt ?? plan.createdAt ?? plan.departureAt
        });
        this.state.activePlanDocument = document;
        window.localStorage.setItem(ACTIVE_PLAN_DOCUMENT_KEY, JSON.stringify(document));
      } catch {
        this.state.activePlanDocument = null;
        window.localStorage.removeItem(ACTIVE_PLAN_DOCUMENT_KEY);
      }
    } else {
      this.state.activePlanDocument = null;
      window.localStorage.removeItem(ACTIVE_PLAN_KEY);
      window.localStorage.removeItem(ACTIVE_PLAN_DOCUMENT_KEY);
    }
    this.notify();
    emit("plan-changed", { planId: plan?.id ?? null });
  }

  setActivePlanDocument(document: PlanDocumentV2 | null) {
    if (document) assertPlanDocumentV2(document);
    const legacy = document ? planV2ToV1(document) : null;
    this.state.activePlanDocument = document;
    this.state.activePlan = legacy;
    if (document && legacy) {
      window.localStorage.setItem(ACTIVE_PLAN_DOCUMENT_KEY, JSON.stringify(document));
      window.localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(legacy));
    } else {
      window.localStorage.removeItem(ACTIVE_PLAN_DOCUMENT_KEY);
      window.localStorage.removeItem(ACTIVE_PLAN_KEY);
    }
    this.notify();
    emit("plan-changed", { planId: document?.id ?? null });
  }

  showToast(message: string, options: ToastOptions = {}) {
    const { durationMs = TOAST_MS, action } = options;
    // Each message gets its own countdown. Without dropping the previous timer, a toast that
    // arrives just before an older one expires is swallowed by that older countdown — which is how
    // the greeting from auto-login used to eat whatever the user did next.
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.patch({ toast: { message, action } });
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.patch({ toast: null });
    }, durationMs);
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
    // Shell/browser-back keeps a small same-document sentinel in history.state. Replacing the
    // URL on every map move must preserve it, otherwise the first pan silently breaks Back.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}${window.location.hash}`
    );
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
