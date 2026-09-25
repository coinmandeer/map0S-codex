import { shouldIgnoreGameKeyEvent } from "../layers/game/characterController";
import type maplibregl from "maplibre-gl";
import { GameHost } from "../layers/game/GameHost";
import { getMapStore } from "../store/mapStore";
import { on, emit } from "../lib/events";
import { apiGet, API_BASE } from "../lib/api";
import { worldRuntime } from "./runtime";
import {
  generateOrbField,
  orbDayKey,
  orbFieldKey,
  orbSectorBbox,
  type OrbRoadFeature
} from "../layers/game/orbsController";
import type { GameQuest, GotchiModel, WorldEntityKind, WorldPosition } from "@mapos/layer-sdk";

/** Read-only scene diagnostics for automated verification. The URL flag is read here rather
 *  than at activation because the shell rewrites the query string during startup; the storage
 *  flag survives that rewrite. */
const GAME_DEBUG =
  import.meta.env.DEV ||
  (typeof window !== "undefined" &&
    (window.localStorage.getItem("mapos:gamedebug") === "1" ||
      new URLSearchParams(window.location.search).has("gamedebug")));

/** Collect range the server accepts for a walk-over pickup, kept slightly under the server's
 *  22 m so a collect never bounces on a rounding difference. */
const AUTO_COLLECT_M = 8;
const COLLECT_RANGE_M = 20;
const FIGHT_RANGE_M = 68;

function distanceM(a: WorldPosition, b: WorldPosition): number {
  const rad = Math.PI / 180;
  return Math.hypot(
    (a.lng - b.lng) * 111320 * Math.cos((a.lat * rad + b.lat * rad) / 2),
    (a.lat - b.lat) * 111320
  );
}

/** The playable world: avatar, entities, zones and the local practice board.
 *
 *  Everything the player sees is drawn in one Three.js scene inside a MapLibre custom layer.
 *  The layer is deliberately chatty on the input side — click, tap, Space, Q and E all resolve
 *  to the same three server actions — so the game is playable with a mouse, a keyboard or a
 *  thumb without a second interaction model. */
export function createWorldLayer(map: maplibregl.Map, apiBase: string, layerId: string) {
  let host: GameHost | null = null,
    avatarKey: string | null = null;
  let disposed = false,
    detached = false,
    defaultTimer: ReturnType<typeof setTimeout> | undefined,
    defaultAttempts = 0;
  let playerPosition = { lng: getMapStore().view.lng, lat: getMapStore().view.lat };
  const recenter = on("game-recenter", () => {
    const state = worldRuntime.get();
    if (!state.snapshot?.positionReady) {
      void worldRuntime.retryLocation();
      return;
    }
    emit("fly-to", { ...(state.snapshot.gamePosition ?? playerPosition), zoom: 18.3 });
  });
  let fieldKey = "",
    roadController: AbortController | null = null,
    zoneController: AbortController | null = null,
    practiceCollected = 0,
    practiceOrbs = 0;
  const collected = new Set<string>();
  let practiceQuests: GameQuest[] = [];
  const publishPractice = () =>
    emit("game-practice", {
      collected: practiceCollected,
      quests: practiceQuests,
      orbs: practiceOrbs
    });
  const loadDefault = async () => {
    if (disposed || !host || worldRuntime.get().model?.status === "ready") return;
    try {
      const model = await apiGet<GotchiModel>("/v2/world/models/default");
      if (!disposed && model.status === "ready" && model.url) {
        avatarKey = model.url;
        await host?.setLiveAvatar(
          `${API_BASE}${model.lods?.find((l) => l.level === "low")?.url.replace(/^\/api/, "") ?? model.url.replace(/^\/api/, "")}`
        );
        return;
      }
    } catch {
      /* the default model may not exist yet; keep polling a bounded number of times */
    }
    if (!disposed && ++defaultAttempts < 36)
      defaultTimer = setTimeout(() => void loadDefault(), 4000);
  };
  /** The local practice board is what the game plays off-line and on a desk. In simulation the
   *  board is always present (even with a server session, so the game is playable without GPS);
   *  GPS mode relies on the authoritative coins instead, so the two never double up on the street. */
  const practiceOnly = () => {
    const state = worldRuntime.get();
    return Boolean(state.testEnabled) && getMapStore().gameTrackingMode === "simulation";
  };
  const refreshBoard = (p: { lng: number; lat: number }) => {
    if (!practiceOnly() || getMapStore().gameTrackingMode !== "simulation") return;
    const key = orbFieldKey("local-practice", p);
    if (key === fieldKey) return;
    fieldKey = key;
    roadController?.abort();
    const controller = new AbortController();
    roadController = controller;
    const draw = (roads: OrbRoadFeature[] = []) => {
      if (disposed || controller.signal.aborted) return;
      const field = generateOrbField({
        userId: "local-practice",
        origin: p,
        lures: [],
        collected,
        map,
        roadFeatures: roads
      });
      practiceOrbs = field.length;
      host?.syncOrbs(field);
      publishPractice();
    };
    draw();
    void fetch(`${apiBase}/game/roads?bbox=${orbSectorBbox(p).join(",")}`, {
      signal: controller.signal
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => draw(data?.roads ?? []))
      .catch(() => {});
  };
  /** Zones and the practice quests are REST reads; the snapshot carries the authoritative zone
   *  list once a session exists, so the fetch is only the signed-out fallback. */
  let zonesFetchedAt = 0,
    zonesKey = "";
  const refreshZones = (p: { lng: number; lat: number }) => {
    if (worldRuntime.get().session) return;
    const key = orbFieldKey("zones", p);
    if (key === zonesKey && Date.now() - zonesFetchedAt < 60_000) return;
    zonesKey = key;
    zonesFetchedAt = Date.now();
    zoneController?.abort();
    const controller = new AbortController();
    zoneController = controller;
    void fetch(`${apiBase}/game/zones?bbox=${orbSectorBbox(p).join(",")}`, {
      signal: controller.signal
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (disposed || controller.signal.aborted) return;
        if (data?.zones) host?.syncZones(data.zones);
        if (data?.quests) {
          practiceQuests = data.quests.map(
            (q: { id: string; title: string; lng: number; lat: number }) => ({
              ...q,
              description: "Průzkumný bod v okolí",
              kind: "visit",
              radiusM: 25,
              xp: 0,
              hint: "Dojdi k bodu",
              checkpoints: [],
              startsAt: 0,
              endsAt: 0,
              completed: practiceQuests.some((old) => old.id === q.id && old.completed),
              checkpoint: 0,
              ownerId: "local-practice"
            })
          );
          host?.syncQuests(data.quests);
          publishPractice();
        }
      })
      .catch(() => {});
  };
  /** Nearest entity of the given kinds, inside range, from the current authoritative snapshot. */
  const nearestEntity = (kinds: WorldEntityKind[], maxM: number) => {
    const state = worldRuntime.get();
    if (!state.snapshot) return null;
    let best: { entity: (typeof state.snapshot.entities)[number]; distance: number } | null = null;
    for (const entity of state.snapshot.entities) {
      if (!kinds.includes(entity.kind)) continue;
      // Collectibles carry no HP; only a dead enemy is an invalid target.
      if (entity.maxHp > 0 && entity.hp <= 0) continue;
      const distance = distanceM(playerPosition, entity);
      if (distance > maxM) continue;
      if (!best || distance < best.distance) best = { entity, distance };
    }
    return best?.entity ?? null;
  };
  let nextAutoCollectAt = 0;
  const autoCollectPickups = () => {
    const state = worldRuntime.get();
    if (!state.session || !state.snapshot) return;
    const now = performance.now();
    if (now < nextAutoCollectAt) return;
    // Small pickups are walk-over in the arcade sense; chests stay explicit so opening one is
    // a deliberate act rather than an accident of the path taken.
    const pickup = nearestEntity(["coin", "essence"], AUTO_COLLECT_M);
    if (!pickup) return;
    nextAutoCollectAt = now + 1200;
    void worldRuntime.action("collect", pickup.id);
  };
  /** One key, one action: attack or cast at the nearest enemy, engage it first when needed. */
  const attackNearest = (type: "shoot" | "cast") => {
    const enemy = nearestEntity(["lickquidator", "boss"], FIGHT_RANGE_M);
    if (!enemy) {
      getMapStore().showToast("Nikdo v dosahu · hledej strážce v zónách");
      return;
    }
    worldRuntime.select(enemy.id);
    if (enemy.engaged) {
      void worldRuntime.action(type, enemy.id);
      return;
    }
    // Engage, then attack once the server has the fight. Awaiting the round trip replaces the
    // fixed 350 ms guess, which raced the server whenever the network was slower than the timer.
    void (async () => {
      await worldRuntime.action("engage", enemy.id);
      await worldRuntime.action(type, enemy.id);
    })();
  };
  const collectNearest = () => {
    const pickup = nearestEntity(["coin", "essence", "chest"], COLLECT_RANGE_M);
    if (!pickup) {
      getMapStore().showToast("Nic poblíž k sebrání");
      return;
    }
    worldRuntime.select(pickup.id);
    void worldRuntime.action("collect", pickup.id);
  };
  const sync = () => {
    const state = worldRuntime.get();
    if (!host) return;
    if (state.snapshot) {
      host.syncWorld(state.snapshot, state.presence, state.notes);
      if (state.snapshot.zones?.length) host.syncZones(state.snapshot.zones);
      if (state.snapshot.gamePosition && getMapStore().gameTrackingMode !== "simulation") {
        playerPosition = state.snapshot.gamePosition;
        host.setPlayerPosition(playerPosition.lng, playerPosition.lat);
        autoCollectPickups();
      }
    }
    if (state.model?.status === "ready" && state.model.url) {
      const url =
        state.model.lods?.find((l) => l.level === (window.innerWidth < 760 ? "low" : "high"))
          ?.url ?? state.model.url;
      avatarKey = url;
      void host.setLiveAvatar(`${API_BASE}${url.replace(/^\/api/, "")}`);
    } else if (avatarKey && state.model?.status === "unavailable") {
      avatarKey = null;
      // Back to the blocky 3D character: the avatar must not fall back to a flat sprite.
      host.setAvatarStyle("cube");
    }
  };
  const layer: maplibregl.CustomLayerInterface = {
    id: `custom-gl-${layerId}`,
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      // A style swap removes the layer and the next style load adds it back to this same handle.
      disposed = false;
      host = new GameHost(m, gl, apiBase);
      host.setAvatarStyle("cube");
      const p = worldRuntime.get().snapshot?.position ?? getMapStore().view;
      host.setPlayerPosition(p.lng, p.lat);
      sync();
      refreshBoard(p);
      refreshZones(p);
      void loadDefault();
      if (GAME_DEBUG) {
        window.__maposGame = host;
        window.render_game_to_text = () =>
          JSON.stringify({
            coordinateSystem: "WGS84 longitude/latitude; scene metres east/north/up",
            ...host?.textState,
            practiceCollected,
            orbField: {
              fieldKey: fieldKey || orbFieldKey("local-practice", playerPosition),
              dayKey: orbDayKey(),
              total: practiceOrbs
            },
            world: worldRuntime.get()
          });
        window.advanceTime = async (ms: number) => {
          host?.advanceTime(ms);
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        };
      }
    },
    render(_gl, args) {
      host?.render(args.defaultProjectionData.mainMatrix);
    },
    onRemove() {
      host?.destroy();
      disposed = true;
      clearTimeout(defaultTimer);
      roadController?.abort();
      zoneController?.abort();
      // The globals may already belong to a newer handle's scene; leave that one alone.
      if (GAME_DEBUG && window.__maposGame === host) {
        delete window.__maposGame;
        delete window.render_game_to_text;
        delete window.advanceTime;
      }
      host = null;
    }
  };
  const off = worldRuntime.subscribe(sync);
  const movement = on("geolocation", (p) => {
    if (getMapStore().gameTrackingMode === "simulation" && !worldRuntime.get().snapshot?.arena) {
      playerPosition = p;
      host?.setPlayerPosition(p.lng, p.lat);
      refreshBoard(p);
      refreshZones(p);
      autoCollectPickups();
      const hits = host?.collectNearbyOrbs(18) ?? [];
      for (const hit of hits) collected.add(hit);
      let changed = false;
      practiceQuests = practiceQuests.map((q) => {
        if (q.completed || (q.kind !== "visit" && q.kind !== "trail")) return q;
        const target = q.kind === "trail" ? (q.checkpoints[q.checkpoint] ?? q) : p;
        const at = q.kind === "visit" ? q : target;
        const distance = Math.hypot(
          (p.lng - at.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180),
          (p.lat - at.lat) * 111320
        );
        if (distance > q.radiusM) return q;
        changed = true;
        const checkpoint = q.checkpoint + 1;
        return {
          ...q,
          checkpoint,
          completed: q.kind === "visit" || checkpoint >= q.checkpoints.length
        };
      });
      if (changed)
        host?.syncQuests(
          practiceQuests.filter((q) => !q.completed).map((q) => ({ ...q, rewardPoints: 0 }))
        );
      if (hits.length) {
        practiceCollected += hits.length;
        getMapStore().showToast(`Průzkum · ${practiceCollected} nasbíraných bodů`);
      }
      if (changed || hits.length) publishPractice();
    }
  });
  const effects = worldRuntime.onEffect((action) =>
    host?.worldEffect(action.type, action.targetId)
  );
  // Capabilities, session and the authoritative snapshot all arrive asynchronously; refresh the
  // board and zones whenever the world state changes, not only on the first frame.
  const unsubscribeWorld = worldRuntime.subscribe(() => {
    if (!host) return;
    refreshBoard(playerPosition);
    refreshZones(playerPosition);
  });
  const pointer = (event: maplibregl.MapMouseEvent) => {
    const canvas = map.getCanvas(),
      rect = canvas.getBoundingClientRect();
    return {
      canvas,
      x: (event.point.x / rect.width) * 2 - 1,
      y: 1 - (event.point.y / rect.height) * 2
    };
  };
  const click = (event: maplibregl.MapMouseEvent) => {
    if (!host) return;
    const { x, y } = pointer(event);
    // Only server-authoritative entities are actionable; legacy mutation endpoints are retired.
    const id = host.pickWorld(x, y);
    if (!id) {
      // Empty map click walks the avatar there (tap-to-move) in simulation; GPS mode is real
      // walking and must not be steerable from the map.
      if (getMapStore().gameTrackingMode === "simulation")
        emit("game-tap-target", { lng: event.lngLat.lng, lat: event.lngLat.lat });
      return;
    }
    if (id.startsWith("presence:")) {
      worldRuntime.openSocial();
      return;
    }
    if (id.startsWith("note:")) {
      worldRuntime.openThread(id.slice(5));
      return;
    }
    worldRuntime.select(id);
    const entity = worldRuntime.get().snapshot?.entities.find((e) => e.id === id);
    if (!entity) return;
    const distance = distanceM(playerPosition, entity);
    // Clicking a thing means doing the thing: walk-over pickups are collected, enemies are
    // engaged. Clicking something out of range only selects it, so the HUD can explain why.
    if (["coin", "essence", "chest"].includes(entity.kind) && distance <= COLLECT_RANGE_M)
      void worldRuntime.action("collect", id);
    else if (["lickquidator", "boss"].includes(entity.kind) && distance <= FIGHT_RANGE_M)
      void worldRuntime.action(entity.engaged ? "shoot" : "engage", id);
  };
  let hoverAt = 0,
    hoverCursor = "";
  const move = (event: maplibregl.MapMouseEvent) => {
    if (!host || performance.now() - hoverAt < 120) return;
    hoverAt = performance.now();
    const { canvas, x, y } = pointer(event);
    const cursor = host.hoverWorld(x, y) ? "pointer" : "";
    if (cursor !== hoverCursor) {
      hoverCursor = cursor;
      canvas.style.cursor = cursor;
    }
  };
  const key = (event: KeyboardEvent) => {
    if (shouldIgnoreGameKeyEvent(event) || event.repeat) return;
    if (worldRuntime.get().socialOpen) return;
    if (event.code === "Space" || event.code === "KeyQ" || event.code === "KeyE") {
      event.preventDefault();
      if (event.code === "KeyE") collectNearest();
      else attackNearest(event.code === "Space" ? "shoot" : "cast");
    }
  };
  const avatarChanged = on("avatar-changed", ({ style, tokenId }) =>
    host?.setAvatarStyle(style === "cube" ? "cube" : "aavegotchi", tokenId)
  );
  const avatarSelected = on("avatar-inventory-selected", ({ selection }) =>
    host?.setAvatarSelection(selection)
  );
  const nearestAction = on("game-action-nearest", ({ type }) => {
    if (type === "collect") collectNearest();
    else attackNearest(type);
  });
  window.addEventListener("keydown", key);
  map.on("click", click);
  map.on("mousemove", move);
  // Entering the game switches to its board style. That drops every custom layer and makes the
  // engine replace this handle with a new one, and the old handle's detach can land after the new
  // one exists. Both used to share the layer id, so the late detach removed the new scene and the
  // first entry into the game after a load often showed an empty board. So: a handle attaches as
  // soon as a style is there, re-attaches after every style load, and removes only its own layer.
  // Leaving the game detaches from inside a `style.load` dispatch, and MapLibre still calls the
  // listeners it copied before the `off`, so a detached handle has to refuse to attach again.
  const attach = () => {
    if (!detached && map.getStyle() && !map.getLayer(layer.id)) map.addLayer(layer);
  };
  const ownsLayer = () => {
    const current = map.getLayer(layer.id) as { implementation?: unknown } | undefined;
    return Boolean(current) && (current!.implementation ?? layer) === layer;
  };
  map.on("style.load", attach);
  if (map.isStyleLoaded()) attach();
  return {
    async update() {
      if (!detached && !map.getLayer(layer.id)) map.addLayer(layer);
      sync();
      // Capabilities/session arrive after onAdd, so the board are (re)checked here;
      // every call is keyed and TTL-guarded, so an unchanged cell costs nothing.
      refreshBoard(playerPosition);
      refreshZones(playerPosition);
      return null;
    },
    setVisible(visible: boolean) {
      host?.setOpacity(visible ? 1 : 0);
    },
    setOpacity(value: number) {
      host?.setOpacity(value);
    },
    detach() {
      detached = true;
      window.removeEventListener("keydown", key);
      unsubscribeWorld();
      off();
      movement();
      recenter();
      effects();
      avatarChanged();
      avatarSelected();
      nearestAction();
      map.off("click", click);
      map.off("mousemove", move);
      map.off("style.load", attach);
      if (ownsLayer()) map.removeLayer(layer.id);
      disposed = true;
      clearTimeout(defaultTimer);
      roadController?.abort();
      zoneController?.abort();
    }
  };
}
