import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, GeoFeature } from "@mapos/layer-sdk";
import { getMapStore } from "../../store/mapStore";
import { emit, on } from "../../lib/events";
import { GAME_AVATAR_V2_ENABLED } from "../../lib/featureFlags";
import { type GameGhost, type GameZone, type GameQuest, type GameEncounter } from "./threeScene";
import { GameHost } from "./GameHost";
import { defaultGamePerformanceTier } from "./gamePerformance";
import { GAME_ROAD_SOURCE } from "./roadSource";
import {
  addOrbXp,
  generateOrbField,
  hasWalkableRoadLayers,
  loadCollectedOrbIds,
  orbDayKey,
  orbFieldKey,
  orbSectorBbox,
  orbSectorCentre,
  persistCollectedOrbIds,
  persistOrbXp,
  pickLures,
  type GameOrb,
  type OrbLure,
  type OrbRoadFeature
} from "./orbsController";

const ROAD_GEOMETRY_SOURCE_ID = "mapos-game-road-geometry";
const ROAD_GEOMETRY_LAYER_ID = "mapos-game-road-lines";
const MAX_ROAD_LOAD_ATTEMPTS = 12;

/** Game layer — Three.js custom-gl layer (Aavegotchi ghosts + zone props). Loaded exclusively
 * through a dynamic `import()` from LayerEngine so three.js never lands in the main bundle. */
export function createGameLayerHandle(map: maplibregl.Map, apiBase: string, layerId: string) {
  let scene: GameHost | null = null;
  let loadedQuestArea: string | null = null;
  const store = getMapStore();
  // Dots belong to a player, not to a browser. A guest session is still an identity, so the
  // only case left is somebody who cleared their session mid-game.
  const playerId = () => store.session?.id ?? "anon";
  let collectedOrbs = loadCollectedOrbIds(playerId());
  let collectedFor = playerId();
  let currentOrbOrigin: { lng: number; lat: number } | null = null;
  let activeOrbFieldKey: string | null = null;
  let activeOrbDayKey = orbDayKey();
  let currentFieldOrbs: GameOrb[] = [];
  let roadFeaturesKey: string | null = null;
  let serverRoadFeatures: OrbRoadFeature[] = [];
  let roadRequest: AbortController | null = null;
  let orbRoadAttempts = 0;
  let orbRoadRetry: ReturnType<typeof setTimeout> | null = null;
  let orbDayReset: ReturnType<typeof setTimeout> | null = null;
  let lures: OrbLure[] = [];
  let announcedLure: string | null = null;
  /** The quests fetched for this area, shaped as features so orb lures can treat them like any
   *  other place the map knows about. */
  let questFeatures: GeoFeature[] = [];
  let ownsRoadGeometry = false;

  /** Raster backgrounds are pictures, so they cannot answer "where is the nearest street?".
   * While game mode is active, mount one nearly transparent vector transportation layer solely
   * for road snapping. It is removed again on exit, so ordinary map use pays no extra tile cost. */
  function ensureRoadGeometry() {
    if (hasWalkableRoadLayers(map)) return;
    try {
      if (!map.getSource(ROAD_GEOMETRY_SOURCE_ID)) {
        map.addSource(ROAD_GEOMETRY_SOURCE_ID, {
          type: "vector",
          url: GAME_ROAD_SOURCE.tileJsonUrl,
          attribution: GAME_ROAD_SOURCE.attribution.map(({ label }) => label).join(", ")
        });
        ownsRoadGeometry = true;
      }
      if (!map.getLayer(ROAD_GEOMETRY_LAYER_ID)) {
        map.addLayer({
          id: ROAD_GEOMETRY_LAYER_ID,
          type: "line",
          source: ROAD_GEOMETRY_SOURCE_ID,
          "source-layer": "transportation",
          filter: ["in", "class", "path", "track", "service", "minor", "secondary", "primary"],
          paint: {
            "line-color": "rgba(0, 0, 0, 0.01)",
            "line-opacity": 0.01,
            "line-width": 2
          }
        });
      }
    } catch {
      // A style swap can briefly make addSource/addLayer unavailable. The normal update/retry
      // path will try again; the game remains usable with a waiting state instead of blocking.
    }
  }

  function removeRoadGeometry() {
    if (!ownsRoadGeometry) return;
    try {
      if (map.getLayer(ROAD_GEOMETRY_LAYER_ID)) map.removeLayer(ROAD_GEOMETRY_LAYER_ID);
      if (map.getSource(ROAD_GEOMETRY_SOURCE_ID)) map.removeSource(ROAD_GEOMETRY_SOURCE_ID);
    } catch {
      // A concurrent style replacement already removed our helper.
    }
    ownsRoadGeometry = false;
  }

  const customLayer: maplibregl.CustomLayerInterface = {
    id: `custom-gl-${layerId}`,
    type: "custom",
    renderingMode: "3d",
    onAdd(mapInstance, gl) {
      scene = new GameHost(mapInstance, gl, apiBase);
      if (import.meta.env.DEV) {
        window.__maposGame = scene;
        window.render_game_to_text = () =>
          JSON.stringify({
            mode: "game",
            tracking: store.gameTrackingMode,
            camera: store.gameCameraMode,
            orbField: orbFieldState(),
            ...scene?.textState
          });
        window.advanceTime = async (ms: number) => {
          scene?.advanceTime(ms);
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        };
      }
      scene.setPerformanceTier(defaultGamePerformanceTier());
      scene.setAvatarStyle(
        GAME_AVATAR_V2_ENABLED ? store.avatarStyle : "cube",
        store.aavegotchiTokenId
      );
      // Where the player is gets broadcast when it changes, and this layer is loaded on demand —
      // late enough to miss the first broadcast and then wait for a move that a standing player
      // never makes. Starting from the middle of the view costs nothing and means the game is
      // playable, with dots laid out, the moment it appears.
      const centre = mapInstance.getCenter();
      scene.setPlayerPosition(centre.lng, centre.lat);
      refreshOrbs({ lng: centre.lng, lat: centre.lat });
      if (store.session) void syncOrbProgress(store.session.id);
    },
    onRemove() {
      if (orbRoadRetry) clearTimeout(orbRoadRetry);
      orbRoadRetry = null;
      if (orbDayReset) clearTimeout(orbDayReset);
      orbDayReset = null;
      // A basemap/style swap removes and re-adds custom layers. Keep any in-flight road field,
      // but force the replacement scene to receive the stable daily board again.
      activeOrbFieldKey = null;
      scene?.destroy();
      scene = null;
      if (import.meta.env.DEV) {
        delete window.__maposGame;
        delete window.render_game_to_text;
        delete window.advanceTime;
      }
    },
    render(_gl, args) {
      // MapLibre 4 handed custom layers the bare projection matrix; 5 hands them a bundle of
      // camera data. Reading it as an array produced a matrix of NaN, which is why the whole game
      // — player, ghosts, quests, dots — was being drawn to nowhere while every count looked right.
      scene?.render(args.defaultProjectionData.mainMatrix);
    }
  };

  const onRoadGeometryData = (event: maplibregl.MapSourceDataEvent) => {
    if (
      event.isSourceLoaded &&
      currentFieldOrbs.length === 0 &&
      currentOrbOrigin &&
      !orbRoadRetry &&
      orbRoadAttempts < MAX_ROAD_LOAD_ATTEMPTS
    ) {
      refreshOrbs(currentOrbOrigin, true);
    }
  };
  map.on("sourcedata", onRoadGeometryData);

  function requestRoadField(origin: { lng: number; lat: number }, fieldKey: string) {
    if (roadFeaturesKey === fieldKey) return;
    roadRequest?.abort();
    roadFeaturesKey = fieldKey;
    serverRoadFeatures = [];
    const controller = new AbortController();
    roadRequest = controller;
    const bbox = orbSectorBbox(origin);
    void fetch(`${apiBase}/game/roads?bbox=${bbox.join(",")}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { roads?: OrbRoadFeature[] } | null) => {
        if (controller.signal.aborted || roadFeaturesKey !== fieldKey) return;
        serverRoadFeatures = data?.roads ?? [];
        if (currentOrbOrigin) refreshOrbs(currentOrbOrigin, true);
      })
      .catch(() => {
        // Rendered vector streets remain the offline fallback. The next kilometre cell retries.
      })
      .finally(() => {
        if (roadRequest === controller) roadRequest = null;
      });
  }

  function refreshOrbs(origin: { lng: number; lat: number }, retryRoads = false) {
    if (!scene) return;
    currentOrbOrigin = origin;

    const userId = playerId();
    if (userId !== collectedFor) {
      collectedOrbs = loadCollectedOrbIds(userId);
      collectedFor = userId;
    }

    const dayKey = orbDayKey();
    const fieldKey = orbFieldKey(userId, origin, dayKey);
    // Player position changes many times per second. The board must not: it is generated once
    // for this player/day/kilometre cell and only filtered as dots are collected.
    if (fieldKey === activeOrbFieldKey && !retryRoads) return;
    if (fieldKey !== activeOrbFieldKey) orbRoadAttempts = 0;
    activeOrbFieldKey = fieldKey;
    activeOrbDayKey = dayKey;
    requestRoadField(origin, fieldKey);
    if (!retryRoads) scheduleNextLocalDay();

    const boardCentre = orbSectorCentre(origin);
    // Lures are selected from the fixed board centre, not the moving avatar. Even a reload from
    // another street in the same cell therefore recreates the same geometry.
    lures = pickLures({ quests: questFeatures, ...store.visibleFeatures }, boardCentre, fieldKey, {
      lng: store.view.lng,
      lat: store.view.lat
    });
    currentFieldOrbs = generateOrbField({
      userId,
      origin,
      lures,
      collected: new Set<string>(),
      map,
      roadFeatures: roadFeaturesKey === fieldKey ? serverRoadFeatures : [],
      dayKey
    });
    syncVisibleOrbs();
    if (currentFieldOrbs.length && orbRoadRetry) {
      clearTimeout(orbRoadRetry);
      orbRoadRetry = null;
    }
    // The custom layer can be added one render before vector tiles become queryable. Retry that
    // startup gap for a bounded six-second window. Slow/mobile tile loads regularly outlasted
    // the former one-second window and left the HUD at 0/0 even though road data arrived later.
    if (!currentFieldOrbs.length && orbRoadAttempts < MAX_ROAD_LOAD_ATTEMPTS && !orbRoadRetry) {
      orbRoadAttempts += 1;
      orbRoadRetry = setTimeout(() => {
        orbRoadRetry = null;
        if (currentOrbOrigin) refreshOrbs(currentOrbOrigin, true);
      }, 500);
    }

    // Say once where the trail goes — a line of dots means nothing until you know it is a line.
    const target = lures[0]?.name ?? null;
    if (target && target !== announcedLure) {
      announcedLure = target;
      store.showToast(`Stopa vede k: ${target}`);
    }
  }

  function scheduleNextLocalDay() {
    if (orbDayReset) clearTimeout(orbDayReset);
    const next = new Date();
    next.setHours(24, 0, 0, 50);
    orbDayReset = setTimeout(
      () => {
        orbDayReset = null;
        activeOrbFieldKey = null;
        if (currentOrbOrigin) refreshOrbs(currentOrbOrigin);
      },
      Math.max(1_000, next.getTime() - Date.now())
    );
  }

  function orbFieldState() {
    const collected = currentFieldOrbs.filter((orb) => collectedOrbs.has(orb.id)).length;
    return {
      dayKey: activeOrbDayKey,
      fieldKey: activeOrbFieldKey ?? "",
      total: currentFieldOrbs.length,
      remaining: currentFieldOrbs.length - collected,
      collected,
      roadOnly: true as const
    };
  }

  function syncVisibleOrbs() {
    scene?.syncOrbs(currentFieldOrbs.filter((orb) => !collectedOrbs.has(orb.id)));
    emit("orb-field-updated", orbFieldState());
  }

  async function submitLocalOrbs(userId: string) {
    const ownedOrbIds = [...collectedOrbs].filter((orbId) => orbId.startsWith(`orb:${userId}:`));
    const response = await fetch(`${apiBase}/game/orbs/collect`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orbIds: ownedOrbIds })
    });
    if (!response.ok) throw new Error(`Orb sync failed: ${response.status}`);
    return (await response.json()) as {
      progress: { xpTotal: number; collectedCount: number; acceptedCount: number };
    };
  }

  /** Migrates the existing local set on first run, then pulls claims made on another device.
   * Replaying the whole set is intentional: the server's primary key makes an interrupted sync
   * idempotent, so no separate client outbox is necessary. */
  async function syncOrbProgress(userId: string) {
    if (userId === "anon") return;
    try {
      await submitLocalOrbs(userId);
      const response = await fetch(`${apiBase}/game/progress`, { credentials: "include" });
      if (!response.ok) throw new Error(`Progress fetch failed: ${response.status}`);
      const data = (await response.json()) as {
        progress: { xpTotal: number; collectedCount: number; collectedOrbIds: string[] };
      };
      if (playerId() !== userId) return;
      collectedOrbs = new Set(data.progress.collectedOrbIds);
      collectedFor = userId;
      persistCollectedOrbIds(userId, collectedOrbs);
      persistOrbXp(userId, data.progress.xpTotal);
      emit("game-progress-synced", {
        collectedCount: data.progress.collectedCount,
        xpTotal: data.progress.xpTotal
      });
      syncVisibleOrbs();
    } catch {
      // Local state remains playable and is replayed on the next activation or collection.
    }
  }

  // Walking into a monster is the encounter: waiting for a tap on a 6-metre model at street
  // zoom made them furniture. Resolved or failed ones stay on a cooldown so a player standing
  // on the spawn is not buried in toasts.
  const encounterCooldowns = new Map<string, number>();
  const ENCOUNTER_RADIUS_M = 30;
  const ENCOUNTER_COOLDOWN_MS = 60_000;
  let liveEncounters: GameEncounter[] = [];
  const distanceM = (aLng: number, aLat: number, bLng: number, bLat: number) => {
    const latRad = (aLat * Math.PI) / 180;
    return Math.hypot((aLat - bLat) * 110_540, (aLng - bLng) * 111_320 * Math.cos(latRad));
  };
  const checkProximityEncounters = (lng: number, lat: number) => {
    const now = Date.now();
    for (const encounter of liveEncounters) {
      const cooledAt = encounterCooldowns.get(encounter.id) ?? 0;
      if (now < cooledAt) continue;
      if (distanceM(lng, lat, encounter.lng, encounter.lat) > ENCOUNTER_RADIUS_M) continue;
      encounterCooldowns.set(encounter.id, now + ENCOUNTER_COOLDOWN_MS);
      void resolveEncounter(encounter.id);
      break;
    }
  };

  const offGeolocation = on("geolocation", (detail) => {
    if (!detail) return;
    scene?.setPlayerPosition(detail.lng, detail.lat);
    checkProximityEncounters(detail.lng, detail.lat);
    const grabbed = scene?.collectNearbyOrbs(15) ?? [];
    if (grabbed.length) {
      scene?.triggerAvatarAnimation("collect");
      const userId = playerId();
      for (const id of grabbed) collectedOrbs.add(id);
      persistCollectedOrbIds(userId, collectedOrbs);
      const xp = addOrbXp(userId, grabbed.length * 10, store.session?.xpTotal ?? 0);
      getMapStore().showToast(`Kulička +${grabbed.length * 10} XP (celkem ${xp})`);
      emit("orbs-collected", { count: grabbed.length, xp });
      syncVisibleOrbs();
      if (userId !== "anon") {
        void submitLocalOrbs(userId)
          .then(({ progress }) => {
            if (playerId() !== userId) return;
            persistOrbXp(userId, progress.xpTotal);
            emit("game-progress-synced", {
              collectedCount: progress.collectedCount,
              xpTotal: progress.xpTotal
            });
          })
          .catch(() => {
            // The full local set is retried on the next collection or game activation.
          });
      }
    }
    refreshOrbs(detail);
  });

  const offAvatarChanged = on("avatar-changed", (detail) => {
    scene?.setAvatarStyle(GAME_AVATAR_V2_ENABLED ? detail.style : "cube", detail.tokenId);
  });

  const offAvatarInventorySelected = on("avatar-inventory-selected", ({ selection }) => {
    if (GAME_AVATAR_V2_ENABLED) scene?.setAvatarSelection(selection);
  });

  const offGamePerformanceChanged = on("game-performance-changed", ({ tier }) => {
    scene?.setPerformanceTier(tier);
  });

  const offSessionChanged = on("session-changed", ({ userId }) => {
    const next = userId ?? "anon";
    collectedOrbs = loadCollectedOrbIds(next);
    collectedFor = next;
    activeOrbFieldKey = null;
    currentFieldOrbs = [];
    if (currentOrbOrigin) refreshOrbs(currentOrbOrigin);
    if (userId) void syncOrbProgress(userId);
  });

  async function catchGhost(id: string) {
    scene?.triggerAvatarAnimation("interact");
    try {
      const res = await fetch(`${apiBase}/game/ghosts/${id}/catch`, {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) {
        getMapStore().showToast(
          res.status === 401 ? "Prihlas se pro chytani duchu" : "Ducha se nepodarilo chytit"
        );
        return;
      }
      scene?.removeGhost(id);
      emit("ghost-caught", { id });
      getMapStore().showToast("Duch chycen!");
    } catch {
      /* retry on next click */
    }
  }

  async function resolveEncounter(id: string) {
    scene?.triggerAvatarAnimation("interact");
    try {
      const res = await fetch(`${apiBase}/game/encounters/${id}/resolve`, {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        getMapStore().showToast(
          data.message ?? (res.status === 401 ? "Prihlas se" : "Encounter selhal")
        );
        return;
      }
      const data = (await res.json()) as { rewardUsd?: number; loot?: string };
      liveEncounters = liveEncounters.filter((encounter) => encounter.id !== id);
      scene?.removeEncounter(id);
      emit("encounter-resolved", { id });
      getMapStore().showToast(`Odmena $${data.rewardUsd ?? 0} · ${data.loot ?? "loot"}`);
    } catch {
      /* retry */
    }
  }

  function onClick(e: maplibregl.MapMouseEvent) {
    if (!scene) return;
    const canvas = map.getCanvas();
    const ndcX = (e.point.x / canvas.clientWidth) * 2 - 1;
    const ndcY = -(e.point.y / canvas.clientHeight) * 2 + 1;
    const ghostId = scene.pickGhostAt(ndcX, ndcY);
    if (ghostId) {
      void catchGhost(ghostId);
      return;
    }
    const encounterId = scene.pickEncounterAt(ndcX, ndcY);
    if (encounterId) {
      void resolveEncounter(encounterId);
      return;
    }
    emit("game-tap-target", { lng: e.lngLat.lng, lat: e.lngLat.lat });
  }
  map.on("click", onClick);

  return {
    async update(
      bbox: Bbox,
      _filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      if (!map.getLayer(customLayer.id)) {
        ensureRoadGeometry();
        map.addLayer(customLayer);
      }

      // Quests anchored to real places depend on where the player is, so this is refetched per
      // coarse viewport rather than once per session — the key keeps that to one request per
      // area instead of one per camera nudge.
      const questAreaKey = bbox.map((n) => n.toFixed(1)).join(",");
      if (loadedQuestArea !== questAreaKey) {
        loadedQuestArea = questAreaKey;
        fetch(`${apiBase}/game/zones?bbox=${bbox.join(",")}`, { signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { zones?: GameZone[]; quests?: GameQuest[] } | null) => {
            if (data?.zones) scene?.syncZones(data.zones);
            if (data?.quests) {
              scene?.syncQuests(data.quests);
              questFeatures = data.quests.map((quest) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [quest.lng, quest.lat] },
                properties: { id: quest.id, name: quest.title, layerId: "game" }
              })) as GeoFeature[];
              // A field that is already on screen is deliberately left untouched. Newly loaded
              // quests can influence the next daily/cell board, never reshuffle today's dots.
            }
          })
          .catch(() => {
            loadedQuestArea = null;
          });
      }

      try {
        const [ghostsRes, encRes] = await Promise.all([
          fetch(`${apiBase}/game/ghosts?bbox=${bbox.join(",")}`, { signal }),
          fetch(`${apiBase}/game/encounters?bbox=${bbox.join(",")}`, { signal })
        ]);
        if (ghostsRes.ok) {
          const data = (await ghostsRes.json()) as { ghosts?: GameGhost[] };
          scene?.syncGhosts(data.ghosts ?? []);
        }
        if (encRes.ok) {
          const data = (await encRes.json()) as { encounters?: GameEncounter[] };
          liveEncounters = data.encounters ?? [];
          scene?.syncEncounters(liveEncounters);
        }
      } catch {
        /* refresh on next tick */
      }

      return null;
    },
    setVisible(visible: boolean) {
      if (!map.getLayer(customLayer.id)) return;
      map.setLayoutProperty(customLayer.id, "visibility", visible ? "visible" : "none");
    },
    /** The 3D scene has no MapLibre paint property to drive, so opacity is applied to the
     *  scene's own materials — otherwise the layer's opacity slider silently did nothing. */
    setOpacity(opacity: number) {
      scene?.setOpacity(opacity);
    },
    detach() {
      if (orbRoadRetry) clearTimeout(orbRoadRetry);
      orbRoadRetry = null;
      if (orbDayReset) clearTimeout(orbDayReset);
      orbDayReset = null;
      roadRequest?.abort();
      roadRequest = null;
      offGeolocation();
      offAvatarChanged();
      offAvatarInventorySelected();
      offGamePerformanceChanged();
      offSessionChanged();
      map.off("sourcedata", onRoadGeometryData);
      map.off("click", onClick);
      if (map.getLayer(customLayer.id)) map.removeLayer(customLayer.id);
      removeRoadGeometry();
    }
  };
}
