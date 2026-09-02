import type { GameRuntimeContext, GameRuntimeModule } from "./gameRegistry";
import { gameById } from "../../product/registry";

function distanceM(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Tiny second game used as an architectural proof: it consumes the shared player's movement
 * and emits one signal per 100 metres, but creates no avatar, camera, WebGL scene or RAF loop. */
export function createTrailSignalsGameModule(context: GameRuntimeContext): GameRuntimeModule {
  const manifest = gameById("trail-signals");
  if (!manifest) throw new Error("Trail Signals manifest is missing");
  let previous: { lng: number; lat: number } | null = null;
  let travelledM = 0;
  let signals = 0;
  let savedSignals = 0;
  let timeCursor = new Date().toISOString();
  void fetch(`${context.apiBase}/games/state?gameId=trail-signals`, { credentials: "include" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { state?: { travelledM?: number; signals?: number } } | null) => {
      travelledM = Math.max(0, Number(data?.state?.travelledM) || 0);
      signals = Math.max(0, Number(data?.state?.signals) || Math.floor(travelledM / 100));
      savedSignals = signals;
    })
    .catch(() => undefined);

  const persist = () => {
    savedSignals = signals;
    void fetch(`${context.apiBase}/games/state`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "trail-signals", state: { travelledM, signals } })
    }).catch(() => undefined);
  };
  return {
    manifest,
    onPlayerPosition(position) {
      if (previous) {
        const step = distanceM(previous, position);
        // GPS jumps and map teleports are not gameplay movement.
        if (step < 250) travelledM += step;
      }
      previous = position;
      signals = Math.min(manifest.maxEntities, Math.floor(travelledM / 100));
      if (signals > savedSignals) persist();
    },
    onTimeCursor(cursor) {
      timeCursor = cursor;
    },
    textState() {
      return {
        namespace: "trail-signals",
        travelledM: Math.round(travelledM),
        signals,
        spacingM: 100,
        timeCursor,
        ownsAvatar: false,
        ownsRenderLoop: false
      };
    },
    destroy() {
      if (signals !== savedSignals) persist();
      previous = null;
    }
  };
}
