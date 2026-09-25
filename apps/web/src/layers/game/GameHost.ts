import type { GeoThread } from "@mapos/layer-sdk";
import type { WorldSnapshot, PublicPresence } from "@mapos/layer-sdk";
import type maplibregl from "maplibre-gl";
import { on } from "../../lib/events";
import { getMapStore } from "../../store/mapStore";
import { createAavegotchiGameModule } from "./aavegotchi/aavegotchiGameModule";
import { createGameRuntime, registerGame, type GameRuntimeModule } from "./gameRegistry";
import { createTrailSignalsGameModule } from "./trailSignalsGameModule";
import type {
  AvatarAssetProvider,
  AvatarInventorySelection,
  GamePerformanceTier
} from "./avatarAssets";
import {
  ThreeScene,
  type GameEncounter,
  type GameGhost,
  type GameOrb,
  type GameQuest,
  type GameZone
} from "./threeScene";

let builtinsRegistered = false;
function registerBuiltins() {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerGame(createAavegotchiGameModule, "aavegotchi");
  registerGame(createTrailSignalsGameModule, "trail-signals");
}

/** Owns the one and only Three.js scene used by every active map game. Individual game modules
 * receive player/time events and namespaced state, never a second avatar, camera or render loop. */
export class GameHost {
  private scene: ThreeScene;
  private modules = new Map<string, GameRuntimeModule>();
  private activeIds: string[] = [];
  private focusedId = "aavegotchi";
  private renderCalls = 0;
  private advancedTimeMs = 0;
  private offGamesChanged: () => void;
  private offTimeChanged: () => void;

  constructor(
    private map: maplibregl.Map,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    private apiBase: string,
    avatarAssetProvider?: AvatarAssetProvider
  ) {
    registerBuiltins();
    this.scene = new ThreeScene(map, gl, avatarAssetProvider);
    const store = getMapStore();
    this.setActiveGames(store.activeGameIds, store.focusedGameId);
    this.offGamesChanged = on("games-changed", ({ activeGameIds, focusedGameId }) => {
      this.setActiveGames(activeGameIds, focusedGameId);
    });
    this.offTimeChanged = on("time-changed", ({ temporal }) => {
      for (const runtime of this.modules.values()) runtime.onTimeCursor?.(temporal.cursor);
    });
  }

  private setActiveGames(ids: string[], focused: string) {
    const next = [...new Set(ids)].slice(0, 4);
    for (const id of next) {
      if (this.modules.has(id)) continue;
      const runtime = createGameRuntime(id, { scene: this.scene, apiBase: this.apiBase });
      if (runtime) this.modules.set(id, runtime);
    }
    for (const [id, runtime] of this.modules) {
      if (next.includes(id)) continue;
      runtime.destroy();
      this.modules.delete(id);
    }
    this.activeIds = next.filter((id) => this.modules.has(id));
    this.focusedId = this.activeIds.includes(focused)
      ? focused
      : (this.activeIds[0] ?? "aavegotchi");
    if (!this.activeIds.includes("aavegotchi")) {
      this.scene.syncZones([]);
      this.scene.syncQuests([]);
      this.scene.syncGhosts([]);
      this.scene.syncEncounters([]);
      this.scene.syncOrbs([]);
    }
  }

  setPlayerPosition(lng: number, lat: number) {
    const position = { lng, lat };
    this.scene.setPlayerPosition(lng, lat);
    for (const runtime of this.modules.values()) runtime.onPlayerPosition?.(position);
  }

  syncWorld(snapshot: WorldSnapshot, presence: PublicPresence[], notes: GeoThread[] = []) {
    this.scene.syncWorld(snapshot, presence, notes);
  }
  setLiveAvatar(url: string) {
    return this.scene.setLiveAvatar(url);
  }
  worldEffect(type: string, targetId: string) {
    this.scene.worldEffect(type, targetId);
  }
  pickWorld(x: number, y: number) {
    return this.scene.pickWorld(x, y);
  }

  setAvatarStyle(style: "cube" | "aavegotchi", tokenId?: string) {
    this.scene.setAvatarStyle(style, tokenId);
  }

  setAvatarSelection(selection: AvatarInventorySelection) {
    this.scene.setAvatarSelection(selection);
  }

  setPerformanceTier(tier: GamePerformanceTier) {
    this.scene.setPerformanceTier(tier);
  }

  triggerAvatarAnimation(state: "collect" | "interact") {
    this.scene.triggerAvatarAnimation(state);
  }

  syncZones(values: GameZone[]) {
    if (this.activeIds.includes("aavegotchi")) this.scene.syncZones(values);
  }
  hoverWorld(x: number, y: number) {
    return this.activeIds.includes("aavegotchi") ? this.scene.hoverWorld(x, y) : null;
  }
  syncQuests(values: GameQuest[]) {
    if (this.activeIds.includes("aavegotchi")) this.scene.syncQuests(values);
  }
  syncGhosts(values: GameGhost[]) {
    if (this.activeIds.includes("aavegotchi")) this.scene.syncGhosts(values);
  }
  syncEncounters(values: GameEncounter[]) {
    if (this.activeIds.includes("aavegotchi")) this.scene.syncEncounters(values);
  }
  syncOrbs(values: GameOrb[]) {
    if (this.activeIds.includes("aavegotchi")) this.scene.syncOrbs(values);
  }
  collectNearbyOrbs(maxM?: number) {
    return this.activeIds.includes("aavegotchi") ? this.scene.collectNearbyOrbs(maxM) : [];
  }
  pickGhostAt(x: number, y: number) {
    return this.activeIds.includes("aavegotchi") ? this.scene.pickGhostAt(x, y) : null;
  }
  pickEncounterAt(x: number, y: number) {
    return this.activeIds.includes("aavegotchi") ? this.scene.pickEncounterAt(x, y) : null;
  }
  removeGhost(id: string) {
    this.scene.removeGhost(id);
  }
  removeEncounter(id: string) {
    this.scene.removeEncounter(id);
  }
  setOpacity(opacity: number) {
    this.scene.setOpacity(opacity);
  }

  render(matrix: ArrayLike<number>) {
    this.renderCalls += 1;
    this.scene.render(matrix);
  }

  advanceTime(ms: number) {
    const delta = Math.max(0, Math.min(60_000, Number(ms) || 0));
    this.advancedTimeMs += delta;
    const cursor = new Date(Date.now() + this.advancedTimeMs).toISOString();
    for (const runtime of this.modules.values()) runtime.onTimeCursor?.(cursor);
    this.map.triggerRepaint();
  }

  get textState() {
    return {
      ...this.scene.textState,
      host: {
        activeGames: this.activeIds,
        focusedGame: this.focusedId,
        avatarOwners: 1,
        renderLoops: 1,
        renderCalls: this.renderCalls,
        advancedTimeMs: this.advancedTimeMs
      },
      modules: Object.fromEntries(
        [...this.modules].map(([id, runtime]) => [id, runtime.textState()])
      )
    };
  }

  /** The original game layer exposed the scene directly in development. Keep its two read-only
   * diagnostics stable while GameHost owns the real scene and render loop. */
  get contents() {
    return this.scene.contents;
  }

  get camera() {
    return this.scene.projectionCamera;
  }

  destroy() {
    this.offGamesChanged();
    this.offTimeChanged();
    for (const runtime of this.modules.values()) runtime.destroy();
    this.modules.clear();
    this.scene.destroy();
  }
}
