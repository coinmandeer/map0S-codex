import { useSyncExternalStore } from "react";
import type {
  GeoThread,
  GameAction,
  GameSession,
  GotchiModel,
  PublicPresence,
  WorldPosition,
  WorldSnapshot
} from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { emit, on } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { geolocation, messageFor } from "../lib/geolocation";

export async function worldCall<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/v2/world${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Akce se nepodařila");
  return data as T;
}
export interface RuntimeState {
  session: GameSession | null;
  snapshot: WorldSnapshot | null;
  presence: PublicPresence[];
  model: GotchiModel | null;
  targetId: string | null;
  error: string | null;
  connected: boolean;
  testEnabled: boolean;
  locationStatus: string;
  socialOpen: boolean;
  socialTab: "Trollbox" | "Kontakty";
  visible: boolean;
  messagePoint: WorldPosition | null;
  /** "Add a quest here" from a place detail: the existing quest composer, seeded with this
   *  point and place name. A quest written from a place is still one quest system (§2.11). */
  questPoint: (WorldPosition & { placeId?: string; anchorName?: string }) | null;
  threadId: string | null;
  socialRevision: number;
  bbox: [number, number, number, number] | null;
  notes: GeoThread[];
  geoFilter: (WorldPosition & { radius: number }) | null;
}
let state: RuntimeState = {
  session: null,
  snapshot: null,
  presence: [],
  model: null,
  targetId: null,
  error: null,
  connected: false,
  testEnabled: false,
  locationStatus: "Zjišťuji polohu…",
  socialOpen: false,
  socialTab: "Trollbox",
  visible: false,
  messagePoint: null,
  questPoint: null,
  threadId: null,
  socialRevision: 0,
  bbox: null,
  notes: [],
  geoFilter: null
};
const listeners = new Set<() => void>();
const effects = new Set<(action: { type: string; targetId: string }) => void>();
export const worldRuntime = {
  get: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  patch: (patch: Partial<RuntimeState>) => {
    if (Object.entries(patch).every(([k, v]) => state[k as keyof RuntimeState] === v)) return;
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  },
  select: (targetId: string | null) => worldRuntime.patch({ targetId }),
  onEffect: (fn: (action: { type: string; targetId: string }) => void) => {
    effects.add(fn);
    return () => {
      effects.delete(fn);
    };
  },
  openSocial: (at?: WorldPosition & { placeId?: string }) =>
    worldRuntime.patch({ socialOpen: true, threadId: null, ...(at ? { messagePoint: at } : {}) }),
  openQuestComposer: (at: WorldPosition & { placeId?: string; anchorName?: string }) =>
    worldRuntime.patch({
      socialOpen: true,
      socialTab: "Trollbox",
      messagePoint: null,
      questPoint: at
    }),
  openContacts: () =>
    worldRuntime.patch({
      socialOpen: true,
      socialTab: "Kontakty",
      threadId: null,
      messagePoint: null
    }),
  openThread: (id: string) => worldRuntime.patch({ socialOpen: true, threadId: id }),
  async action(type: GameAction["type"], targetId = state.targetId, answer?: string) {
    if (!state.session || !targetId) return;
    try {
      const action = {
        type,
        targetId,
        actionId: crypto.randomUUID(),
        ...(answer !== undefined ? { answer } : {})
      };
      const snapshot = await worldCall<WorldSnapshot>("/action", {
        sessionId: state.session.id,
        action
      });
      effects.forEach((fn) => fn({ type, targetId }));
      const xp = snapshot.progress.xp - (state.snapshot?.progress.xp ?? snapshot.progress.xp);
      if (xp > 0) getMapStore().showToast(`+${xp} XP · odměna potvrzena`);
      worldRuntime.patch({ snapshot, error: null });
    } catch (error) {
      worldRuntime.patch({ error: (error as Error).message });
    }
  },
  async retryLocation() {
    worldRuntime.patch({ locationStatus: "Zjišťuji polohu…" });
    try {
      await geolocation.getPosition({ maxAgeMs: 0 });
    } catch (error) {
      worldRuntime.patch({ locationStatus: messageFor(error) });
    }
  },
  async visibility(visible: boolean, checkIn?: { title: string; lng: number; lat: number }) {
    if (!state.session) return;
    try {
      await worldCall("/presence", { sessionId: state.session.id, visible, checkIn });
      worldRuntime.patch({ visible, error: null });
    } catch (error) {
      worldRuntime.patch({ error: (error as Error).message });
    }
  }
};
export const useWorld = () =>
  useSyncExternalStore(worldRuntime.subscribe, worldRuntime.get, worldRuntime.get);

/** One transport per app session; the scene and all chat panels consume the same store. */
export function attachWorldRuntime() {
  const store = getMapStore();
  let socket: WebSocket | null = null,
    activeUser: string | null = null,
    activeMode: string | null = null;
  let disposed = false,
    subscribed = false,
    generation = 0,
    starting = false,
    lastPosition: WorldPosition | null = null,
    accuracy = 9999,
    observedAt = 0;
  let stopGps: (() => void) | null = null,
    modelPolling = false;
  let modelPollAt = 0,
    retryAt = 0;
  const sync = async () => {
    const needed =
      document.visibilityState === "visible" &&
      (store.mode === "game" || state.socialOpen || state.visible);
    const user = store.session?.id;
    if (!needed || !user) {
      socket?.close();
      socket = null;
      stopGps?.();
      stopGps = null;
      lastPosition = null;
      worldRuntime.patch({
        connected: false,
        ...(!user ? { session: null, snapshot: null, presence: [], visible: false } : {})
      });
      return;
    }
    const mode =
      store.mode === "game" && store.gameTrackingMode === "simulation" ? "explore" : "gps";
    if (activeUser !== user || activeMode !== mode) retryAt = 0;
    if (Date.now() < retryAt) return;
    if (starting || (activeUser === user && activeMode === mode && socket && socket.readyState < 2))
      return;
    starting = true;
    const gen = ++generation;
    // A response may arrive after leaving the feature, switching accounts/modes or hiding the
    // tab. Recheck demand after each await before starting GPS or a live connection.
    const current = () =>
      !disposed &&
      gen === generation &&
      document.visibilityState === "visible" &&
      (store.mode === "game" || state.socialOpen || state.visible) &&
      store.session?.id === user &&
      (store.mode === "game" && store.gameTrackingMode === "simulation" ? "explore" : "gps") ===
        mode;
    socket?.close();
    stopGps?.();
    stopGps = null;
    lastPosition = null;
    accuracy = 9999;
    try {
      const caps = await fetch(`${API_BASE}/v2/world/capabilities`, {
        credentials: "include"
      }).then((r) => r.json());
      if (!current()) return;
      worldRuntime.patch({ testEnabled: caps.testEnabled === true });
      if (caps.enabled === false)
        throw new Error("Herní a sociální vrstva je na tomto serveru vypnutá.");
      const session = await worldCall<GameSession>("/session", { mode });
      if (!current()) return;
      activeMode = mode;
      activeUser = user;
      worldRuntime.patch({
        session,
        snapshot: null,
        presence: [],
        model: null,
        error: null,
        visible: false
      });
      if (mode === "explore") {
        worldRuntime.patch({ locationStatus: "Virtuální průzkum · bez GPS odměn" });
        lastPosition = { lng: store.view.lng, lat: store.view.lat };
        accuracy = 0;
      } else
        stopGps = geolocation.watch(
          (fix) => {
            lastPosition = { lng: fix.lng, lat: fix.lat };
            accuracy = fix.accuracy;
            observedAt = fix.receivedAt;
            worldRuntime.patch({
              locationStatus:
                Date.now() - observedAt > 30000
                  ? "Poloha je zastaralá. Obnov polohu."
                  : accuracy > 40
                    ? `Poloha je nepřesná (±${Math.round(accuracy)} m). Pro hraní potřebujeme nejvýše 40 m.`
                    : "Poloha připravena"
            });
            if (store.mode === "game") emit("geolocation", lastPosition);
          },
          (error) => worldRuntime.patch({ locationStatus: messageFor(error) })
        );
      const url = new URL(`${API_BASE}/v2/world/live`, location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;
      subscribed = false;
      ws.onopen = () => {
        if (socket !== ws) return;
        ws.send(JSON.stringify({ type: "subscribe", sessionId: session.id }));
      };
      ws.onmessage = (event) => {
        if (socket !== ws) return;
        const message = JSON.parse(event.data);
        if (message.type === "subscribed") {
          subscribed = true;
          sendPosition();
          worldRuntime.patch({ connected: true, error: null });
        }
        if (message.type === "snapshot")
          worldRuntime.patch({
            snapshot: message.snapshot,
            presence: message.presence ?? state.presence
          });
        if (message.type === "error") worldRuntime.patch({ error: message.message });
        if (message.type === "social-refresh")
          worldRuntime.patch({ socialRevision: state.socialRevision + 1 });
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        subscribed = false;
        retryAt = Date.now() + 3000;
        worldRuntime.patch({
          connected: false,
          error: "Živé spojení se přerušilo. Znovu připojuji…"
        });
      };
    } catch (error) {
      if (current()) {
        retryAt = Date.now() + 5000;
        worldRuntime.patch({ error: (error as Error).message, connected: false });
        activeMode = null;
      }
    } finally {
      starting = false;
    }
  };
  function sendPosition() {
    if (activeMode === "gps" && observedAt && Date.now() - observedAt >= 30000)
      worldRuntime.patch({ locationStatus: "Poloha je zastaralá. Obnov polohu." });
    if (
      subscribed &&
      socket?.readyState === 1 &&
      lastPosition &&
      (activeMode === "explore" || Date.now() - observedAt < 30000)
    )
      socket.send(
        JSON.stringify({
          type: "position",
          position: lastPosition,
          accuracy,
          observedAt: activeMode === "explore" ? Date.now() : observedAt
        })
      );
  }
  const offPosition = on("geolocation", (p) => {
    if (activeMode === "explore") {
      lastPosition = p;
      accuracy = 0;
    }
  });
  // A quest written from a place detail opens the one quest composer, seeded with that place.
  const offQuest = on("open-world-quest", (at) => worldRuntime.openQuestComposer(at));
  const interval = setInterval(() => {
    if (document.visibilityState !== "visible") {
      socket?.close();
      socket = null;
      stopGps?.();
      stopGps = null;
      lastPosition = null;
      return;
    }
    void sync();
    sendPosition();
    if (
      state.session?.avatarTokenId &&
      (!state.model || state.model.status === "pending") &&
      !modelPolling &&
      Date.now() > modelPollAt
    ) {
      const id = state.session.id;
      modelPolling = true;
      modelPollAt = Date.now() + 4000;
      void worldCall<GotchiModel>("/models/request", { sessionId: id })
        .then((model) => {
          if (state.session?.id === id) worldRuntime.patch({ model });
        })
        .catch(() => {})
        .finally(() => {
          modelPolling = false;
        });
    }
  }, 1000);
  void sync();
  return () => {
    disposed = true;
    generation++;
    clearInterval(interval);
    offPosition();
    offQuest();
    stopGps?.();
    socket?.close();
    worldRuntime.patch({ connected: false });
  };
}
