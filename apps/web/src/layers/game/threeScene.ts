import * as THREE from "three";
import maplibregl from "maplibre-gl";
import type mapboxglNS from "maplibre-gl";
import {
  instantiate,
  loadModel,
  pickAction,
  pickZoneModelKey,
  preloadModels,
  type ModelKey
} from "./modelCatalog";
import { createGhostSprite, createPlaceholderGhostSprite } from "./ghostRenderer";
import { hashSeed, metersToLngLatOffset, mulberry32 } from "./zoneUtils";

export interface GameZone {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  category?: string | null;
  lootTier?: string | null;
  zoneKind?: string | null;
}

export interface GameQuest {
  id: string;
  title: string;
  lng: number;
  lat: number;
  rewardPoints: number;
}

export interface GameEncounter {
  id: string;
  lng: number;
  lat: number;
  templateKind: string;
  lootTier: string;
}

export interface GameGhost {
  id: string;
  lng: number;
  lat: number;
  gotchiId: string | null;
}

export interface GameOrb {
  id: string;
  lng: number;
  lat: number;
}

function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function createFallbackPlayer(): THREE.Group {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xb7791f });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf3d5b5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 4.1, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 3.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 12), skinMat);
  head.position.z = 6.3;
  const legGeom = new THREE.CylinderGeometry(0.32, 0.38, 2.1, 8);
  const legL = new THREE.Mesh(legGeom, bodyMat);
  legL.rotation.x = Math.PI / 2;
  legL.position.set(-0.5, 0.15, 1.05);
  const legR = legL.clone();
  legR.position.x = 0.5;
  root.add(body, head, legL, legR);
  return root;
}

const PLAYER_POSITION_LERP = 0.14;
const PLAYER_HEADING_LERP = 0.18;
/** Anchor is re-rooted once the player/view drifts this far, to keep Three.js coordinates
 * (single-precision floats) close to the origin — otherwise distant geometry starts jittering. */
const ANCHOR_RECENTER_DEG = 0.05;

function lerpAngle(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

/**
 * Manages the Three.js scene shared with MapLibre's WebGL context.
 *
 * The zoom-desync bug in the previous implementation came from positioning objects in meters
 * (divided by a per-frame-recomputed scale) while feeding MapLibre's raw mercator-space matrix
 * straight into the camera — the two used incompatible units so objects drifted relative to the
 * basemap as the mercator-to-meter ratio changed with zoom. The fix (ported from the original
 * QuestLayer engine) bakes the anchor translation *and* meter scale into the camera's
 * projection matrix itself, every single frame, straight from the `matrix` MapLibre hands us —
 * nothing about the camera is cached between frames.
 */
export class ThreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private anchor: { lng: number; lat: number; merc: mapboxglNS.MercatorCoordinate } | null = null;

  private playerRoot: THREE.Group | null = null;
  private playerMixer: THREE.AnimationMixer | null = null;
  private playerLngLat: { lng: number; lat: number } | null = null;
  private playerHeading = 0;
  private playerTargetHeading = 0;

  private zoneProps = new Map<string, THREE.Group>();
  private questProps = new Map<string, THREE.Group>();
  private encounterProps = new Map<string, THREE.Group>();
  private ghostSprites = new Map<string, THREE.Sprite>();
  private orbMeshes = new Map<string, THREE.Mesh>();
  private gotchiAvatarSprite: THREE.Sprite | null = null;
  private avatarStyle: "cube" | "aavegotchi" = "cube";
  private raycaster = new THREE.Raycaster();
  private lastRenderAt = 0;
  private disposed = false;
  private opacity = 1;

  constructor(
    private map: maplibregl.Map,
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(60, 120, 90);
    this.scene.add(dir);

    const center = map.getCenter();
    this.setAnchor(center.lng, center.lat);

    void loadModel("player").then((loaded) => {
      if (this.disposed) return;
      if (loaded) {
        const instance = instantiate(loaded, "player");
        this.playerRoot = instance.root;
        this.playerMixer = instance.mixer;
        const walk = pickAction(instance.actions, ["walk", "run", "idle"]);
        walk?.play();
      } else {
        this.playerRoot = createFallbackPlayer();
      }
      this.scene.add(this.playerRoot);
      this.map.triggerRepaint();
    });

    preloadModels([
      "tree",
      "treeA",
      "bush",
      "crystal",
      "chest",
      "goblin",
      "wolf",
      "demon",
      "giant",
      "chicken"
    ]);
  }

  /** Applies the layer opacity across every material in the scene. Objects added later pick
   *  it up because the value is stored and re-applied on each sync. */
  setOpacity(opacity: number) {
    const next = Math.max(0, Math.min(1, opacity));
    if (next === this.opacity) return;
    this.opacity = next;
    this.applyOpacity();
    this.map.triggerRepaint();
  }

  private applyOpacity() {
    const opacity = this.opacity;
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh | THREE.Sprite).material as
        THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        m.transparent = opacity < 1 || m.transparent;
        m.opacity = opacity;
        m.needsUpdate = true;
      }
    });
  }

  setAvatarStyle(style: "cube" | "aavegotchi", gotchiId?: string) {
    this.avatarStyle = style;
    if (this.gotchiAvatarSprite) {
      this.scene.remove(this.gotchiAvatarSprite);
      this.gotchiAvatarSprite = null;
    }
    if (style === "aavegotchi" && gotchiId) {
      void import("./ghostRenderer").then(({ createGhostSprite }) =>
        createGhostSprite(gotchiId).then((sprite) => {
          if (this.disposed) return;
          sprite.scale.set(8, 8, 1);
          this.gotchiAvatarSprite = sprite;
          this.scene.add(sprite);
          this.map.triggerRepaint();
        })
      );
    }
    if (this.playerRoot) this.playerRoot.visible = style === "cube";
  }

  private setAnchor(lng: number, lat: number) {
    this.anchor = { lng, lat, merc: maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0) };
  }

  private localFromLngLat(lng: number, lat: number): { x: number; y: number } {
    if (!this.anchor) return { x: 0, y: 0 };
    const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
    const scale = this.anchor.merc.meterInMercatorCoordinateUnits();
    return {
      x: (merc.x - this.anchor.merc.x) / scale,
      y: -(merc.y - this.anchor.merc.y) / scale
    };
  }

  setPlayerPosition(lng: number, lat: number) {
    const prev = this.playerLngLat;
    this.playerLngLat = { lng, lat };
    if (prev && Math.hypot(lng - prev.lng, lat - prev.lat) > 1e-7) {
      this.playerTargetHeading = Math.atan2(lng - prev.lng, lat - prev.lat);
    }
    if (!this.anchor) this.setAnchor(lng, lat);
    else if (
      Math.abs(lng - this.anchor.lng) > ANCHOR_RECENTER_DEG ||
      Math.abs(lat - this.anchor.lat) > ANCHOR_RECENTER_DEG
    ) {
      this.setAnchor(lng, lat);
    }
    this.map.triggerRepaint();
  }

  syncZones(zones: GameZone[]) {
    const seen = new Set<string>();
    for (const zone of zones) {
      seen.add(zone.id);
      if (this.zoneProps.has(zone.id)) continue;
      const group = new THREE.Group();
      this.zoneProps.set(zone.id, group);
      this.scene.add(group);
      void this.populateZone(zone, group);
    }
    for (const [id, group] of this.zoneProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.zoneProps.delete(id);
      }
    }
  }

  private async populateZone(zone: GameZone, group: THREE.Group) {
    const rand = mulberry32(hashSeed(zone.id));
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const key: ModelKey = pickZoneModelKey(Math.floor(rand() * 1000), zone.category);
      const loaded = await loadModel(key);
      if (!loaded || this.disposed || !this.zoneProps.has(zone.id)) continue;
      const instance = instantiate(loaded, key);
      const angle = rand() * Math.PI * 2;
      const radius = 8 + rand() * Math.min(Math.max(zone.radiusM, 15), 60);
      const { dLng, dLat } = metersToLngLatOffset(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        zone.lat
      );
      instance.root.userData.lng = zone.lng + dLng;
      instance.root.userData.lat = zone.lat + dLat;
      instance.root.rotation.z = rand() * Math.PI * 2;
      group.add(instance.root);
      this.map.triggerRepaint();
    }
  }

  syncQuests(quests: GameQuest[]) {
    const seen = new Set<string>();
    for (const quest of quests) {
      seen.add(quest.id);
      if (this.questProps.has(quest.id)) continue;
      const group = new THREE.Group();
      group.userData = { lng: quest.lng, lat: quest.lat, questId: quest.id };
      this.questProps.set(quest.id, group);
      this.scene.add(group);
      void loadModel("chest").then((loaded) => {
        if (!loaded || this.disposed || !this.questProps.has(quest.id)) return;
        const instance = instantiate(loaded, "chest");
        group.add(instance.root);
        this.map.triggerRepaint();
      });
    }
    for (const [id, group] of this.questProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.questProps.delete(id);
      }
    }
  }

  syncEncounters(encounters: GameEncounter[]) {
    const seen = new Set<string>();
    for (const enc of encounters) {
      seen.add(enc.id);
      if (this.encounterProps.has(enc.id)) continue;
      const group = new THREE.Group();
      group.userData = { lng: enc.lng, lat: enc.lat, encounterId: enc.id };
      this.encounterProps.set(enc.id, group);
      this.scene.add(group);
      const modelKey = (
        ["goblin", "wolf", "demon", "giant", "chicken"].includes(enc.templateKind)
          ? enc.templateKind
          : "goblin"
      ) as ModelKey;
      void loadModel(modelKey).then((loaded) => {
        if (!loaded || this.disposed || !this.encounterProps.has(enc.id)) return;
        const instance = instantiate(loaded, modelKey);
        group.add(instance.root);
        this.map.triggerRepaint();
      });
    }
    for (const [id, group] of this.encounterProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.encounterProps.delete(id);
      }
    }
  }

  removeEncounter(id: string) {
    const group = this.encounterProps.get(id);
    if (!group) return;
    this.scene.remove(group);
    this.encounterProps.delete(id);
  }

  syncGhosts(ghosts: GameGhost[]) {
    const seen = new Set<string>();
    for (const ghost of ghosts) {
      seen.add(ghost.id);
      if (this.ghostSprites.has(ghost.id)) continue;
      const placeholder = createPlaceholderGhostSprite();
      placeholder.userData = { lng: ghost.lng, lat: ghost.lat, ghostId: ghost.id };
      this.ghostSprites.set(ghost.id, placeholder);
      this.scene.add(placeholder);

      void createGhostSprite(ghost.gotchiId ?? "0").then((sprite) => {
        if (this.disposed || !this.ghostSprites.has(ghost.id)) return;
        sprite.userData = { lng: ghost.lng, lat: ghost.lat, ghostId: ghost.id };
        this.scene.remove(placeholder);
        this.scene.add(sprite);
        this.ghostSprites.set(ghost.id, sprite);
        this.map.triggerRepaint();
      });
    }
    for (const [id, sprite] of this.ghostSprites) {
      if (!seen.has(id)) {
        this.scene.remove(sprite);
        this.ghostSprites.delete(id);
      }
    }
  }

  removeGhost(id: string) {
    const sprite = this.ghostSprites.get(id);
    if (!sprite) return;
    this.scene.remove(sprite);
    this.ghostSprites.delete(id);
  }

  syncOrbs(orbs: GameOrb[]) {
    const seen = new Set<string>();
    for (const orb of orbs) {
      seen.add(orb.id);
      if (this.orbMeshes.has(orb.id)) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd166 })
      );
      mesh.userData = { lng: orb.lng, lat: orb.lat, orbId: orb.id };
      this.orbMeshes.set(orb.id, mesh);
      this.scene.add(mesh);
    }
    for (const [id, mesh] of this.orbMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.orbMeshes.delete(id);
      }
    }
    this.map.triggerRepaint();
  }

  collectNearbyOrbs(maxM = 8): string[] {
    if (!this.playerLngLat) return [];
    const collected: string[] = [];
    for (const [id, mesh] of this.orbMeshes) {
      const { lng, lat } = mesh.userData as { lng: number; lat: number };
      if (haversineM(this.playerLngLat, { lng, lat }) <= maxM) collected.push(id);
    }
    for (const id of collected) {
      const mesh = this.orbMeshes.get(id);
      if (!mesh) continue;
      this.scene.remove(mesh);
      this.orbMeshes.delete(id);
    }
    return collected;
  }

  /** Casts a ray from normalized device coordinates (both in [-1, 1]) against ghost sprites. */
  pickGhostAt(ndcX: number, ndcY: number): string | null {
    if (!this.ghostSprites.size) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const entries = Array.from(this.ghostSprites.entries());
    const hits = this.raycaster.intersectObjects(
      entries.map(([, s]) => s),
      false
    );
    if (!hits.length) return null;
    const hitObject = hits[0]!.object;
    return entries.find(([, s]) => s === hitObject)?.[0] ?? null;
  }

  pickEncounterAt(ndcX: number, ndcY: number): string | null {
    if (!this.encounterProps.size) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const groups = Array.from(this.encounterProps.values());
    const hits = this.raycaster.intersectObjects(groups, true);
    if (!hits.length) return null;
    let node: THREE.Object3D | null = hits[0]!.object;
    while (node) {
      const id = (node.userData as { encounterId?: string }).encounterId;
      if (id) return id;
      node = node.parent;
    }
    return null;
  }

  render(matrix: number[] | Float32Array) {
    if (!this.anchor || this.disposed) return;

    const scale = this.anchor.merc.meterInMercatorCoordinateUnits();
    const projection = new THREE.Matrix4().fromArray(Array.from(matrix) as number[]);
    const translate = new THREE.Matrix4().makeTranslation(
      this.anchor.merc.x,
      this.anchor.merc.y,
      this.anchor.merc.z ?? 0
    );
    const scaleMatrix = new THREE.Matrix4().makeScale(scale, -scale, scale);
    this.camera.projectionMatrix = projection.multiply(translate).multiply(scaleMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const now = performance.now();
    const dt = this.lastRenderAt === 0 ? 0.016 : Math.min((now - this.lastRenderAt) / 1000, 0.1);
    this.lastRenderAt = now;

    // Cheaper than threading opacity through every sync method, and objects stream in
    // asynchronously (GLBs, gotchi sprites) so a one-shot application would miss them.
    if (this.opacity < 1) this.applyOpacity();

    if (this.playerLngLat && this.playerRoot) {
      const { x, y } = this.localFromLngLat(this.playerLngLat.lng, this.playerLngLat.lat);
      this.playerRoot.position.lerp(new THREE.Vector3(x, y, 0), PLAYER_POSITION_LERP);
      this.playerHeading = lerpAngle(
        this.playerHeading,
        this.playerTargetHeading,
        PLAYER_HEADING_LERP
      );
      this.playerRoot.rotation.z = this.playerHeading;
    }
    this.playerMixer?.update(dt);

    for (const group of this.zoneProps.values()) {
      for (const child of group.children) {
        const { lng, lat } = child.userData as { lng: number; lat: number };
        const { x, y } = this.localFromLngLat(lng, lat);
        child.position.set(x, y, child.position.z);
      }
    }
    for (const group of [...this.questProps.values(), ...this.encounterProps.values()]) {
      const { lng, lat } = group.userData as { lng: number; lat: number };
      const { x, y } = this.localFromLngLat(lng, lat);
      group.position.set(x, y, 0);
    }
    if (this.gotchiAvatarSprite && this.playerLngLat) {
      const { x, y } = this.localFromLngLat(this.playerLngLat.lng, this.playerLngLat.lat);
      this.gotchiAvatarSprite.position.set(x, y, 8);
    }
    for (const sprite of this.ghostSprites.values()) {
      const { lng, lat } = sprite.userData as { lng: number; lat: number };
      const { x, y } = this.localFromLngLat(lng, lat);
      sprite.position.set(x, y, 6);
    }
    const pulse = 0.9 + Math.sin(now / 220) * 0.18;
    for (const mesh of this.orbMeshes.values()) {
      const { lng, lat } = mesh.userData as { lng: number; lat: number };
      const { x, y } = this.localFromLngLat(lng, lat);
      mesh.position.set(x, y, 1.6);
      mesh.scale.setScalar(pulse);
    }

    this.renderer.resetState();
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);

    // Keep animating (walk cycle, ghost arrival) even when the map camera is idle.
    this.map.triggerRepaint();
  }

  destroy() {
    this.disposed = true;
    this.renderer.dispose();
  }
}
