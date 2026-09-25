import type { Bbox, ExperienceId, TemporalState, GeoFeature } from "@mapos/layer-sdk";
import type {
  DataProvider,
  GameCameraMode,
  GameTrackingMode,
  LayerMode,
  ThemeMode
} from "../store/mapStore";

/** The application's cross-module signals, in one place.
 *
 *  These stay on top of `window` events rather than becoming a bespoke emitter: modules that
 *  never import each other (the store, the MapLibre instance, the Three.js game layer) already
 *  talk this way, and routing them through a shared object would mean threading it through
 *  every constructor. What was missing was types — `new CustomEvent("mapos:fly-to", ...)`
 *  spelled slightly wrong is a listener that silently never fires, and every listener was
 *  re-declaring its own idea of the payload shape by casting.
 *
 *  Adding a signal means adding a line here; that line is what makes it exist for callers. */
export interface MapOsEvents {
  "favorite-layers-changed": string[];
  "layer-settings-request": { itemId: string };
  "layer-style-changed": { id: string };
  /** Move the camera. `zoom` defaults to 14. */
  "fly-to": { lng: number; lat: number; zoom?: number };
  "fit-bounds": { bbox: Bbox };
  "ai-result-hover": { layerId: string; featureId: string } | null;
  "ai-pin-hover": { layerId: string; featureId: string } | null;
  "cluster-list": {
    features: GeoFeature[];
    layerId: string;
    total: number;
    page?: (offset: number) => Promise<GeoFeature[]>;
  };
  /** Refetch expensive layers for the current viewport, bypassing the "Search here" gate. */
  "search-here": undefined;
  "refresh-layer": { id: string };
  "game-recenter": undefined;
  "game-practice": {
    collected: number;
    quests: import("@mapos/layer-sdk").GameQuest[];
    orbs?: number;
  };
  /** The set of active layers, their filters or opacity changed. */
  "layers-changed": undefined;
  "mode-changed": { mode: LayerMode };
  "provider-changed": { provider: DataProvider };
  /** The map background, or whether labels sit over it, changed. */
  "basemap-changed": { basemapId: string };
  "buildings-3d-changed": { enabled: boolean };
  "terrain-3d-changed": { enabled: boolean };
  "country-changed": { countryCode: string };
  "tag-changed": { tag: string | null };
  "theme-changed": { theme: ThemeMode };
  "experience-changed": { id: ExperienceId };
  "time-changed": { temporal: TemporalState };
  "map-place-context": { lng: number; lat: number; x: number; y: number } | null;
  "plan-changed": { planId: string | null };
  /** A dimmed variant line was clicked on the map (§16.6); the planner owns the document, so
   *  the map only reports which variant the user pointed at. */
  "plan-alternative-picked": { segmentId: string; alternativeId: string };
  "games-changed": { activeGameIds: string[]; focusedGameId: string };
  "weather-grid-updated": {
    variable: string;
    unit: string;
    median: number;
    min: number;
    max: number;
    sampleCount: number;
    validAt: string;
    representation: "continuous-grid" | "cells" | "numeric-sectors" | "smooth-field";
    renderedCount: number;
    targetCellAreaKm2: 50 | 25 | 10;
  };
  "weather-cell-selected": {
    interaction: "hover" | "tap";
    variable: string;
    variableLabel: string;
    value: number;
    label: string;
    unit: string;
    validAt: string;
    lng: number;
    lat: number;
  };
  /** A territory tapped in a thematic overlay; the card fetches the rest by code. */
  "theme-unit-selected": { themeId: string; geoLevel: string; code: string; name: string };
  "game-tracking-changed": { mode: GameTrackingMode };
  "game-camera-changed": { mode: GameCameraMode };
  "avatar-changed": { style: "cube" | "aavegotchi"; tokenId: string };
  "avatar-inventory-selected": {
    selection: {
      inventoryItemId: string;
      displayName: string;
      source: "neutral-placeholder" | "fixture" | "verified-inventory";
      tokenReference?: string;
      assetId?: string;
    };
  };
  "game-performance-changed": { tier: "low" | "balanced" };
  "game-movement-vector": {
    source: "touch" | "accessible";
    x: number;
    y: number;
    active: boolean;
  };
  "game-tap-mode": { enabled: boolean };
  "game-tap-target": { lng: number; lat: number };
  "game-movement-cancel": undefined;
  /** The arcade HUD's action row: resolve the nearest target in the game layer and act. */
  "game-action-nearest": { type: "shoot" | "cast" | "collect" };
  "game-controller-status": {
    anchorMode: "locked-to-gps" | "free-roam" | "prototype-center";
    activeInput: "keyboard" | "touch" | "accessible" | "tap" | "gps" | null;
    moving: boolean;
    tapToMoveEnabled: boolean;
    hasTapTarget: boolean;
    gpsAccuracyM: number | null;
  };
  "session-changed": { userId: string | null; xpTotal: number };
  /** The player's position in the game layer. Owned by useSimulationController — it is the
   *  single source of continuous position for the game, so nothing else may emit it. */
  geolocation: { lng: number; lat: number };
  /** Settled camera centre, emitted even while the basemap style is still loading. */
  "map-view-changed": { lng: number; lat: number; zoom: number };
  "map-bearing": { bearing: number };
  /** A map click while an edit layer is armed. */
  "edit-tap": { lng: number; lat: number };
  /** A map click while a location picker is waiting: the click is the answer, not a pan. */
  "map-picker-tap": { lng: number; lat: number };
  "discover-geojson": { geojson: GeoJSON.FeatureCollection };
  "discover-viewport": { lng: number; lat: number; zoom: number; bbox: Bbox };
  "discover-click": Record<string, unknown>;
  /** The floating "What is here?" chip: refresh the discover context for the current centre. */
  "discover-here": undefined;
  "ghost-caught": { id: string };
  "encounter-resolved": { id: string };
  "orbs-collected": { count: number; xp: number };
  "orb-field-updated": {
    dayKey: string;
    fieldKey: string;
    total: number;
    remaining: number;
    collected: number;
    roadOnly: true;
  };
  "game-progress-synced": { collectedCount: number; xpTotal: number };
  /** "Add a quest here" from a place detail: open the quest composer seeded with this point,
   *  so a quest written from a place is the same kind of object as any other quest (§2.11). */
  "open-world-quest": {
    lng: number;
    lat: number;
    placeId: string;
    anchorName: string;
  };
  /** The satellites layer re-propagated: how many are drawn and for which instant. Lets the
   *  legend/footer say the position is computed rather than observed. */
  "satellites-updated": { count: number; at: string };
}

type EventName = keyof MapOsEvents;

const PREFIX = "mapos:";

type Payload<K extends EventName> = MapOsEvents[K];

/** Emit a signal. Payload-less events are called with one argument. */
export function emit<K extends EventName>(
  ...args: undefined extends Payload<K> ? [type: K] : [type: K, detail: Payload<K>]
): void {
  if (typeof window === "undefined") return;
  const [type, detail] = args as [K, Payload<K>];
  window.dispatchEvent(new CustomEvent(`${PREFIX}${type}`, { detail }));
}

/** Subscribe to a signal. Returns the unsubscribe function, so callers can hand it straight
 *  back from a `useEffect` instead of repeating the add/remove pair and risking a mismatch. */
export function on<K extends EventName>(
  type: K,
  handler: (detail: Payload<K>) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<Payload<K>>).detail);
  window.addEventListener(`${PREFIX}${type}`, listener);
  return () => window.removeEventListener(`${PREFIX}${type}`, listener);
}

/** Subscribe to several signals that share one handler, e.g. anything that should trigger a
 *  refetch. Returns a single unsubscribe covering all of them. */
export function onAny<K extends EventName>(types: readonly K[], handler: () => void): () => void {
  const offs = types.map((type) => on(type, handler as (detail: Payload<K>) => void));
  return () => offs.forEach((off) => off());
}
