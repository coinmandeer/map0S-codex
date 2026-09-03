import type { Bbox, ExperienceId, TemporalState } from "@mapos/layer-sdk";
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
  /** Move the camera. `zoom` defaults to 14. */
  "fly-to": { lng: number; lat: number; zoom?: number };
  "fit-bounds": { bbox: Bbox };
  /** Refetch expensive layers for the current viewport, bypassing the "Search here" gate. */
  "search-here": undefined;
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
    representation: "continuous-grid" | "cells" | "numeric-sectors";
    renderedCount: number;
    targetCellAreaKm2: 50 | 20 | 10;
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
  "discover-geojson": { geojson: GeoJSON.FeatureCollection };
  "discover-viewport": { lng: number; lat: number; zoom: number; bbox: Bbox };
  "discover-click": Record<string, unknown>;
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
