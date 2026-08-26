import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues } from "@mapos/layer-sdk";
import { getMapStore } from "../../store/mapStore";
import {
  ThreeScene,
  type GameGhost,
  type GameZone,
  type GameQuest,
  type GameEncounter
} from "./threeScene";
import {
  addOrbXp,
  generateStreetOrbs,
  loadCollectedOrbIds,
  persistCollectedOrbIds
} from "./orbsController";

/** Game layer — Three.js custom-gl layer (Aavegotchi ghosts + zone props). Loaded exclusively
 * through a dynamic `import()` from LayerEngine so three.js never lands in the main bundle. */
export function createGameLayerHandle(map: maplibregl.Map, apiBase: string, layerId: string) {
  let scene: ThreeScene | null = null;
  let zonesLoaded = false;
  const store = getMapStore();
  const collectedOrbs = loadCollectedOrbIds();
  let lastOrbOrigin: { lng: number; lat: number } | null = null;

  const customLayer: maplibregl.CustomLayerInterface = {
    id: `custom-gl-${layerId}`,
    type: "custom",
    renderingMode: "3d",
    onAdd(mapInstance, gl) {
      scene = new ThreeScene(mapInstance, gl);
      scene.setAvatarStyle(store.avatarStyle, store.aavegotchiTokenId);
    },
    onRemove() {
      scene?.destroy();
      scene = null;
    },
    render(_gl, matrix) {
      scene?.render(matrix as unknown as number[]);
    }
  };

  function refreshOrbs(origin: { lng: number; lat: number }) {
    if (!scene) return;
    if (
      lastOrbOrigin &&
      Math.hypot(origin.lng - lastOrbOrigin.lng, origin.lat - lastOrbOrigin.lat) < 0.0008
    ) {
      return;
    }
    lastOrbOrigin = origin;
    const orbs = generateStreetOrbs(map, origin, collectedOrbs);
    scene.syncOrbs(orbs);
  }

  function onGeolocation(e: Event) {
    const detail = (e as CustomEvent<{ lng: number; lat: number }>).detail;
    if (!detail) return;
    scene?.setPlayerPosition(detail.lng, detail.lat);
    const grabbed = scene?.collectNearbyOrbs(8) ?? [];
    if (grabbed.length) {
      for (const id of grabbed) collectedOrbs.add(id);
      persistCollectedOrbIds(collectedOrbs);
      const xp = addOrbXp(grabbed.length * 10);
      getMapStore().showToast(`Kulička +${grabbed.length * 10} XP (celkem ${xp})`);
      window.dispatchEvent(
        new CustomEvent("mapos:orbs-collected", { detail: { count: grabbed.length, xp } })
      );
    }
    refreshOrbs(detail);
  }
  window.addEventListener("mapos:geolocation", onGeolocation);

  function onAvatarChanged(e: Event) {
    const detail = (e as CustomEvent<{ style: "cube" | "aavegotchi"; tokenId: string }>).detail;
    scene?.setAvatarStyle(detail.style, detail.tokenId);
  }
  window.addEventListener("mapos:avatar-changed", onAvatarChanged);

  async function catchGhost(id: string) {
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
      window.dispatchEvent(new CustomEvent("mapos:ghost-caught", { detail: { id } }));
      getMapStore().showToast("Duch chycen!");
    } catch {
      /* retry on next click */
    }
  }

  async function resolveEncounter(id: string) {
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
      scene?.removeEncounter(id);
      window.dispatchEvent(new CustomEvent("mapos:encounter-resolved", { detail: { id } }));
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
    if (encounterId) void resolveEncounter(encounterId);
  }
  map.on("click", onClick);

  return {
    async update(
      bbox: Bbox,
      _filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      if (!map.getLayer(customLayer.id)) {
        map.addLayer(customLayer);
      }

      if (!zonesLoaded) {
        zonesLoaded = true;
        fetch(`${apiBase}/game/zones`, { signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { zones?: GameZone[]; quests?: GameQuest[] } | null) => {
            if (data?.zones) scene?.syncZones(data.zones);
            if (data?.quests) scene?.syncQuests(data.quests);
          })
          .catch(() => {
            zonesLoaded = false;
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
          scene?.syncEncounters(data.encounters ?? []);
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
      window.removeEventListener("mapos:geolocation", onGeolocation);
      window.removeEventListener("mapos:avatar-changed", onAvatarChanged);
      map.off("click", onClick);
      if (map.getLayer(customLayer.id)) map.removeLayer(customLayer.id);
    }
  };
}
