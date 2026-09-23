import type { GeoThread } from "@mapos/layer-sdk";
import { WorldObjects } from "../../world/WorldObjects";
import type { WorldSnapshot, PublicPresence } from "@mapos/layer-sdk";
import * as THREE from "three";
import maplibregl from "maplibre-gl";
import type mapboxglNS from "maplibre-gl";
import { MAX_ORBS, type GameOrb as OrbShape } from "./orbsController";
import {
  instantiate,
  instantiateModel,
  loadModel,
  loadModelSpec,
  pickAction,
  type ModelInstance,
  type ModelKey,
  type ModelSpec
} from "./modelCatalog";
import {
  NEUTRAL_AVATAR_SELECTION,
  animationCandidates,
  defaultAvatarAssetProvider,
  selectAvatarLod,
  type AvatarAnimationState,
  type AvatarAssetProvider,
  type AvatarAssetResolution,
  type AvatarInventorySelection,
  type AvatarLodLevel,
  type GamePerformanceTier
} from "./avatarAssets";
import { legacyAvatarSelection } from "./avatarInventory";
import { GamePerformanceMonitor, defaultGamePerformanceTier } from "./gamePerformance";
import { createNeutralAvatar, type NeutralAvatarInstance } from "./neutralAvatar";
import { createPlaceholderGhostSprite, disposeSprite } from "./ghostRenderer";

/** Short clock label for a zone with a schedule; null when there is nothing to count. */
export function zoneCountdownText(zone: GameZone): string | null {
  const seconds = zone.lifecycle === "scheduled" ? zone.startsInSeconds : zone.endsInSeconds;
  if (seconds === null || seconds === undefined) return null;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const value = minutes >= 60 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`;
  return zone.lifecycle === "scheduled" ? `▸ ${value}` : `◂ ${value}`;
}

export interface GameZone {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  category?: string | null;
  lootTier?: string | null;
  zoneKind?: string | null;
  minStakeUsd?: number;
  activeFrom?: string | null;
  activeUntil?: string | null;
  isTemporary?: boolean;
  lifecycle?: "active" | "scheduled" | "expired";
  isLive?: boolean;
  startsInSeconds?: number | null;
  endsInSeconds?: number | null;
  sizeTier?: "S" | "M" | "L" | "XL";
  eventTag?: string | null;
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

/** Owned by orbsController, which decides where dots go; the scene only draws them. */
export type GameOrb = OrbShape;

function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function disposeObjectResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (material) {
      for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

const PLAYER_POSITION_LERP = 0.28;
const PLAYER_HEADING_LERP = 0.18;
const PLAYER_SETTLE_DISTANCE_SQ = 0.01;
const PLAYER_SETTLE_HEADING = 0.004;
/** The scene asks MapLibre for at most 30 frames per second while the player is moving. MapLibre
 * can still render faster during a camera gesture, but an idle game no longer manufactures work. */
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
  private worldObjects: WorldObjects | null = null;
  private liveAvatarUrl: string | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private anchor: { lng: number; lat: number; merc: mapboxglNS.MercatorCoordinate } | null = null;

  private playerRoot: THREE.Group | null = null;
  private playerMixer: THREE.AnimationMixer | null = null;
  private playerActions = new Map<string, THREE.AnimationAction>();
  private playerAnimationAction: THREE.AnimationAction | null = null;
  private playerAnimationState: AvatarAnimationState = "idle";
  private neutralAvatar: NeutralAvatarInstance | null = null;
  private playerVisualKind: "legacy" | "neutral" | "asset-glb" | null = null;
  private playerMoving = false;
  private playerOwnsResources = false;
  private playerLngLat: { lng: number; lat: number } | null = null;
  private playerDisplayPosition = new THREE.Vector3();
  private playerTargetPosition = new THREE.Vector3();
  private playerDisplayReady = false;
  private playerHeading = 0;
  private playerTargetHeading = 0;

  private zoneProps = new Map<string, THREE.Group>();
  private zoneData = new Map<string, GameZone>();
  private zoneCountdowns = new Map<
    string,
    {
      sprite: THREE.Sprite;
      canvas: HTMLCanvasElement;
      context: CanvasRenderingContext2D;
      texture: THREE.CanvasTexture;
      text: string;
    }
  >();
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private questProps = new Map<string, THREE.Group>();
  private encounterProps = new Map<string, THREE.Group>();
  private ghostSprites = new Map<string, THREE.Sprite>();
  private orbData = new Map<string, GameOrb>();
  private orbSphereGeometry = new THREE.SphereGeometry(2.2, 8, 6);
  private orbSphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private orbSphereMesh = new THREE.InstancedMesh(
    this.orbSphereGeometry,
    this.orbSphereMaterial,
    MAX_ORBS
  );
  private orbHaloGeometry = new THREE.CircleGeometry(7, 16);
  private orbHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });
  private orbHaloMesh = new THREE.InstancedMesh(
    this.orbHaloGeometry,
    this.orbHaloMaterial,
    MAX_ORBS
  );
  private questGeometry = new THREE.OctahedronGeometry(3.4, 0);
  private questMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  });
  private playerMarker: THREE.Mesh;
  private avatarStyle: "cube" | "aavegotchi" = "cube";
  private avatarRequest = 0;
  private avatarSelection: AvatarInventorySelection = NEUTRAL_AVATAR_SELECTION;
  private avatarResolution: AvatarAssetResolution = {
    kind: "neutral-placeholder",
    selection: NEUTRAL_AVATAR_SELECTION,
    reason: "no-asset"
  };
  private avatarLod: AvatarLodLevel | null = null;
  private desiredAvatarLod: AvatarLodLevel | null = null;
  private avatarLoadStartedAt: number | null = null;
  private avatarLoadMs: number | null = null;
  private avatarLoadError: string | null = null;
  private avatarInteractionUntil = 0;
  private performanceTier: GamePerformanceTier;
  private performanceMonitor = new GamePerformanceMonitor();
  private lastAvatarZoomBand = -1;
  private raycaster = new THREE.Raycaster();
  private lastRenderAt = 0;
  private disposed = false;
  private opacity = 1;
  private repaintTimer: ReturnType<typeof setTimeout> | null = null;
  private projectionTranslate = new THREE.Matrix4();
  private projectionScale = new THREE.Matrix4();
  private instanceMatrix = new THREE.Matrix4();
  private instanceColour = new THREE.Color();

  constructor(
    private map: maplibregl.Map,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    private avatarAssetProvider: AvatarAssetProvider = defaultAvatarAssetProvider
  ) {
    this.performanceTier = defaultGamePerformanceTier();
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

    this.playerMarker = new THREE.Mesh(
      new THREE.RingGeometry(4.4, 6.2, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffb020,
        transparent: true,
        opacity: 0.78,
        depthWrite: false
      })
    );
    this.playerMarker.position.z = 0.08;
    this.scene.add(this.playerMarker);

    this.orbSphereMesh.count = 0;
    this.orbHaloMesh.count = 0;
    this.orbSphereMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbHaloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.orbSphereMesh, this.orbHaloMesh);

    const center = map.getCenter();
    this.setAnchor(center.lng, center.lat);
  }

  syncWorld(snapshot: WorldSnapshot, presence: PublicPresence[], notes: GeoThread[] = []) {
    if (!this.worldObjects) {
      this.worldObjects = new WorldObjects((lng, lat) => this.localFromLngLat(lng, lat));
      this.scene.add(this.worldObjects.root);
      if (this.playerVisualKind === "neutral") this.mountNeutralAvatar();
    }
    this.worldObjects.sync(snapshot, presence, notes);
    this.requestRepaint();
  }
  worldEffect(type: string, targetId: string) {
    this.worldObjects?.effect(type, targetId, this.playerLngLat);
    this.triggerAvatarAnimation("interact");
  }
  pickWorld(x: number, y: number) {
    return this.worldObjects?.pick(x, y, this.camera) ?? null;
  }
  hoverWorld(x: number, y: number) {
    return this.worldObjects?.hover(x, y, this.camera) ?? null;
  }
  async setLiveAvatar(url: string) {
    if (this.liveAvatarUrl === url) return;
    this.liveAvatarUrl = url;
    const request = ++this.avatarRequest;
    const loaded = await loadModelSpec(url, { url, targetHeight: 6, animated: true });
    if (this.disposed || request !== this.avatarRequest) return;
    if (!loaded) {
      this.avatarLoadError = "3D model se nepodařilo načíst";
      this.liveAvatarUrl = null;
      return;
    }
    const instance = instantiateModel(loaded, {
      url,
      targetHeight: 6,
      animated: true,
      yawOffset: Math.PI
    });
    this.clearPlayerVisual();
    this.avatarStyle = "aavegotchi";
    this.mountPlayerInstance(instance, "asset-glb", false);
    this.requestRepaint();
  }

  private ensurePlayerModel() {
    if (this.disposed || (this.playerRoot && this.playerVisualKind === "legacy")) return;
    const request = ++this.avatarRequest;
    this.clearPlayerVisual();
    void loadModel("player").then((loaded) => {
      if (this.disposed || request !== this.avatarRequest || this.avatarStyle !== "cube") return;
      if (loaded) {
        const instance = instantiate(loaded, "player");
        this.mountPlayerInstance(instance, "legacy", false);
      } else {
        // Deployments that cannot ship the unverified GLB still get a walking body, not a box.
        this.mountNeutralAvatar();
        this.playerVisualKind = "legacy";
      }
      this.requestRepaint();
    });
  }

  private clearPlayerVisual() {
    this.playerMixer?.stopAllAction();
    if (this.playerRoot) {
      this.scene.remove(this.playerRoot);
      if (this.neutralAvatar) this.neutralAvatar.dispose();
      else if (this.playerOwnsResources) disposeObjectResources(this.playerRoot);
    }
    this.playerRoot = null;
    this.playerMixer = null;
    this.playerActions = new Map();
    this.playerAnimationAction = null;
    this.neutralAvatar = null;
    this.playerOwnsResources = false;
    this.playerVisualKind = null;
  }

  private mountPlayerRoot(
    root: THREE.Group,
    kind: "legacy" | "neutral" | "asset-glb",
    ownsResources: boolean
  ) {
    this.playerRoot = root;
    this.playerVisualKind = kind;
    this.playerOwnsResources = ownsResources;
    root.position.copy(this.playerDisplayPosition);
    root.rotation.z = this.playerHeading;
    if (this.opacity < 1) this.applyOpacityTo(root);
    this.scene.add(root);
    this.applyAvatarAnimation(this.playerMoving ? "walk" : "idle", true);
  }

  private mountPlayerInstance(
    instance: ModelInstance,
    kind: "legacy" | "asset-glb",
    ownsResources: boolean
  ) {
    this.playerMixer = instance.mixer;
    this.playerActions = instance.actions;
    this.mountPlayerRoot(instance.root, kind, ownsResources);
  }

  private mountNeutralAvatar() {
    this.clearPlayerVisual();
    // The procedural 3D character, never the flat ghost sprite: the player must read as a body
    // walking the street even when no GLB is deployable (unverified model provenance) and while
    // a live avatar model is still decoding.
    const neutral = createNeutralAvatar(this.performanceTier);
    this.neutralAvatar = neutral;
    this.avatarLod = null;
    this.mountPlayerRoot(neutral.root, "neutral", false);
  }

  private actionForState(state: AvatarAnimationState): THREE.AnimationAction | null {
    let candidates: string[] = [state];
    if (this.avatarStyle === "aavegotchi" && this.avatarResolution.kind === "asset-glb") {
      candidates = animationCandidates(this.avatarResolution.descriptor, state);
    } else if (state === "walk") {
      candidates = ["walk", "run"];
    }
    for (const candidate of candidates) {
      for (const [name, action] of this.playerActions) {
        if (name.includes(candidate.toLowerCase())) return action;
      }
    }
    return state === "idle" || state === "walk"
      ? pickAction(this.playerActions, state === "walk" ? ["walk", "run"] : ["idle"])
      : null;
  }

  private applyAvatarAnimation(state: AvatarAnimationState, force = false) {
    if (!force && state === this.playerAnimationState) return;
    this.playerAnimationState = state;
    this.neutralAvatar?.setAnimation(state);
    const next = this.actionForState(state);
    if (next === this.playerAnimationAction) return;
    this.playerAnimationAction?.fadeOut(0.12);
    this.playerAnimationAction = next;
    if (next) {
      next.reset().fadeIn(0.12).play();
      if (state === "idle" && this.playerMixer) {
        this.playerMixer.update(0);
        next.paused = true;
      } else {
        next.paused = false;
      }
    }
  }

  private ensureAvatarAssetForZoom() {
    if (this.disposed || this.liveAvatarUrl || this.avatarResolution.kind !== "asset-glb") return;
    const { descriptor } = this.avatarResolution;
    const lod = selectAvatarLod(descriptor, this.performanceTier, this.map.getZoom());
    if (this.avatarLod === lod.level || this.desiredAvatarLod === lod.level) return;
    this.desiredAvatarLod = lod.level;
    this.avatarLoadStartedAt = performance.now();
    this.avatarLoadError = null;
    const request = this.avatarRequest;
    const spec: ModelSpec = {
      url: lod.url,
      targetHeight: descriptor.targetHeightM,
      yawOffset: Math.PI,
      animated: true
    };
    void loadModelSpec(`avatar:${descriptor.id}:${descriptor.version}:${lod.level}`, spec).then(
      (loaded) => {
        if (
          this.disposed ||
          request !== this.avatarRequest ||
          this.avatarResolution.kind !== "asset-glb" ||
          this.avatarResolution.descriptor.id !== descriptor.id ||
          this.desiredAvatarLod !== lod.level
        )
          return;
        this.avatarLoadMs = Math.max(0, performance.now() - (this.avatarLoadStartedAt ?? 0));
        if (!loaded) {
          this.avatarLoadError = "glb-load-failed";
          this.desiredAvatarLod = null;
          return;
        }
        const instance = instantiateModel(loaded, spec);
        this.clearPlayerVisual();
        this.avatarLod = lod.level;
        this.desiredAvatarLod = null;
        this.mountPlayerInstance(instance, "asset-glb", false);
        this.requestRepaint();
      }
    );
  }

  private requestRepaint() {
    if (this.disposed) return;
    if (this.repaintTimer) {
      clearTimeout(this.repaintTimer);
      this.repaintTimer = null;
    }
    this.map.triggerRepaint();
  }

  private requestAnimationRepaint() {
    if (this.disposed || this.repaintTimer) return;
    this.repaintTimer = setTimeout(
      () => {
        this.repaintTimer = null;
        if (!this.disposed) this.map.triggerRepaint();
      },
      1000 / (this.performanceTier === "low" ? 24 : 30)
    );
  }

  /** Applies the layer opacity across every material in the scene. Objects added later pick
   *  it up because the value is stored and re-applied on each sync. */
  setOpacity(opacity: number) {
    const next = Math.max(0, Math.min(1, opacity));
    if (next === this.opacity) return;
    this.opacity = next;
    this.applyOpacityTo(this.scene);
    this.requestRepaint();
  }

  private applyOpacityTo(root: THREE.Object3D) {
    root.traverse((object) => {
      const material = (object as THREE.Mesh | THREE.Sprite).material as
        THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        const metadata = m.userData as {
          maposBaseOpacity?: number;
          maposBaseTransparent?: boolean;
        };
        metadata.maposBaseOpacity ??= m.opacity;
        metadata.maposBaseTransparent ??= m.transparent;
        const effectiveOpacity = metadata.maposBaseOpacity * this.opacity;
        const transparent = Boolean(metadata.maposBaseTransparent || effectiveOpacity < 1);
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = effectiveOpacity;
      }
    });
  }

  setAvatarStyle(style: "cube" | "aavegotchi", gotchiId?: string) {
    this.avatarStyle = style;
    if (style === "cube") {
      this.ensurePlayerModel();
      return;
    }
    this.setAvatarSelection(legacyAvatarSelection(style, gotchiId));
  }

  setAvatarSelection(selection: AvatarInventorySelection) {
    this.liveAvatarUrl = null;
    this.avatarStyle = "aavegotchi";
    this.avatarSelection = selection;
    this.avatarResolution = this.avatarAssetProvider.resolve(selection, this.performanceTier);
    this.avatarRequest += 1;
    this.desiredAvatarLod = null;
    this.avatarLod = null;
    this.avatarLoadMs = null;
    this.avatarLoadError = null;
    // A synchronous original 3D placeholder keeps movement available during GLB decode and is
    // also the permanent safe fallback when the URL or performance validation fails.
    this.mountNeutralAvatar();
    this.ensureAvatarAssetForZoom();
    this.requestRepaint();
  }

  setPerformanceTier(tier: GamePerformanceTier) {
    if (tier === this.performanceTier) return;
    this.performanceTier = tier;
    this.orbHaloMesh.visible = tier !== "low";
    this.lastAvatarZoomBand = -1;
    if (this.avatarStyle === "aavegotchi") this.setAvatarSelection(this.avatarSelection);
    this.requestRepaint();
  }

  triggerAvatarAnimation(state: "collect" | "interact", durationMs = 700) {
    this.avatarInteractionUntil = performance.now() + Math.max(150, Math.min(2_000, durationMs));
    this.applyAvatarAnimation(state);
    this.requestAnimationRepaint();
  }

  private setAnchor(lng: number, lat: number) {
    this.anchor = { lng, lat, merc: maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0) };
    if (this.playerLngLat) {
      const position = this.localFromLngLat(this.playerLngLat.lng, this.playerLngLat.lat);
      this.playerTargetPosition.set(position.x, position.y, 0);
      this.playerDisplayPosition.copy(this.playerTargetPosition);
      this.playerDisplayReady = true;
    }
    this.updateStaticPositions();
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
    let reanchored = false;
    if (!this.anchor) {
      this.setAnchor(lng, lat);
      reanchored = true;
    } else if (
      Math.abs(lng - this.anchor.lng) > ANCHOR_RECENTER_DEG ||
      Math.abs(lat - this.anchor.lat) > ANCHOR_RECENTER_DEG
    ) {
      this.setAnchor(lng, lat);
      reanchored = true;
    }
    if (!reanchored) {
      const position = this.localFromLngLat(lng, lat);
      this.playerTargetPosition.set(position.x, position.y, 0);
      if (!this.playerDisplayReady) {
        this.playerDisplayPosition.copy(this.playerTargetPosition);
        this.playerDisplayReady = true;
      }
    }
    this.playerMarker.position.set(
      this.playerDisplayPosition.x,
      this.playerDisplayPosition.y,
      0.08
    );
    this.requestRepaint();
  }

  private positionObject(object: THREE.Object3D, lng: number, lat: number, z: number) {
    const position = this.localFromLngLat(lng, lat);
    object.position.set(position.x, position.y, z);
  }

  /** Geographic positions only change when data changes or the kilometre-scale local anchor is
   * recentered. Recomputing Mercator coordinates for every prop and orb on every frame was pure
   * idle cost. */
  private updateStaticPositions() {
    if (!this.anchor) return;
    for (const group of this.zoneProps.values()) {
      for (const child of group.children) {
        const { lng, lat } = child.userData as { lng?: number; lat?: number };
        if (Number.isFinite(lng) && Number.isFinite(lat))
          this.positionObject(child, lng!, lat!, child.position.z);
      }
    }
    for (const group of [...this.questProps.values(), ...this.encounterProps.values()]) {
      const { lng, lat } = group.userData as { lng: number; lat: number };
      this.positionObject(group, lng, lat, 0);
    }
    for (const sprite of this.ghostSprites.values()) {
      const { lng, lat } = sprite.userData as { lng: number; lat: number };
      this.positionObject(sprite, lng, lat, 6);
    }
    this.renderOrbInstances();
  }

  private renderOrbInstances() {
    let index = 0;
    for (const orb of this.orbData.values()) {
      if (index >= MAX_ORBS) break;
      const { x, y } = this.localFromLngLat(orb.lng, orb.lat);
      this.instanceColour.setHex(orb.towards ? 0x63d2ff : 0xffd166);

      this.instanceMatrix.makeTranslation(x, y, 1.6);
      this.orbSphereMesh.setMatrixAt(index, this.instanceMatrix);
      this.orbSphereMesh.setColorAt(index, this.instanceColour);

      this.instanceMatrix.makeTranslation(x, y, 0.2);
      this.orbHaloMesh.setMatrixAt(index, this.instanceMatrix);
      this.orbHaloMesh.setColorAt(index, this.instanceColour);
      index += 1;
    }
    this.orbSphereMesh.count = index;
    this.orbHaloMesh.count = index;
    this.orbSphereMesh.instanceMatrix.needsUpdate = true;
    this.orbHaloMesh.instanceMatrix.needsUpdate = true;
    if (this.orbSphereMesh.instanceColor) this.orbSphereMesh.instanceColor.needsUpdate = true;
    if (this.orbHaloMesh.instanceColor) this.orbHaloMesh.instanceColor.needsUpdate = true;
    if (index > 0) {
      this.orbSphereMesh.computeBoundingSphere();
      this.orbHaloMesh.computeBoundingSphere();
    }
  }

  private setPlayerMoving(moving: boolean) {
    if (moving === this.playerMoving) return;
    this.playerMoving = moving;
    if (performance.now() < this.avatarInteractionUntil) return;
    this.applyAvatarAnimation(moving ? "walk" : "idle");
  }

  syncZones(zones: GameZone[]) {
    const seen = new Set<string>();
    let removed = false;
    for (const zone of zones) {
      seen.add(zone.id);
      this.zoneData.set(zone.id, zone);
      if (this.zoneProps.has(zone.id)) continue;
      const group = new THREE.Group();
      this.zoneProps.set(zone.id, group);
      this.scene.add(group);
      this.addZoneBeacon(zone, group);
    }
    for (const [id, group] of this.zoneProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.disposeZoneBeacon(group);
        this.zoneProps.delete(id);
        this.zoneData.delete(id);
        removed = true;
      }
    }
    if (removed) this.requestRepaint();
  }

  private addZoneBeacon(zone: GameZone, group: THREE.Group) {
    const kind = zone.zoneKind ?? "standard";
    const colour = kind === "event" ? 0xffc857 : kind === "staker_gate" ? 0xa855f7 : 0x21d4b4;
    const opacity = zone.lifecycle === "scheduled" ? 0.3 : 0.72;
    const radius = Math.max(24, Math.min(zone.radiusM, 240));
    // Every zone a recognisable silhouette instead of the same circle: the id picks the shape,
    // so it is stable between visits without the API carrying geometry.
    let hash = 0;
    for (const ch of zone.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const sides = [3, 4, 5, 6, 8][hash % 5]!;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(1, radius - 3), radius, sides),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: opacity * 0.65,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    ring.position.z = 0.12;
    ring.rotation.z = ((hash >> 3) % 360) * (Math.PI / 180);

    const geometry =
      kind === "event"
        ? new THREE.OctahedronGeometry(6)
        : kind === "staker_gate"
          ? new THREE.TorusGeometry(6, 1.5, 8, 28)
          : new THREE.IcosahedronGeometry(5.5, 0);
    const beacon = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity
      })
    );
    beacon.position.z = 9;

    for (const object of [ring, beacon]) {
      object.userData = { lng: zone.lng, lat: zone.lat, zoneProcedural: true };
      this.positionObject(object, zone.lng, zone.lat, object.position.z);
      if (this.opacity < 1) this.applyOpacityTo(object);
      group.add(object);
    }

    const label = this.ensureZoneCountdown(zone);
    if (label) {
      label.userData = { lng: zone.lng, lat: zone.lat, zoneProcedural: true };
      this.positionObject(label, zone.lng, zone.lat, 22);
      group.add(label);
    }
    this.requestRepaint();
  }

  /** The countdown lives on the map, not just in the HUD: a temporary zone is defined by its
   *  clock, and a clock you have to open a panel to see might as well not exist. */
  private ensureZoneCountdown(zone: GameZone): THREE.Sprite | null {
    const text = zoneCountdownText(zone);
    let entry = this.zoneCountdowns.get(zone.id);
    if (!text) {
      if (entry) {
        disposeObjectResources(entry.sprite);
        this.zoneCountdowns.delete(zone.id);
      }
      return null;
    }
    if (!entry) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
      );
      sprite.scale.set(56, 14, 1);
      entry = { sprite, canvas, context, texture, text: "" };
      this.zoneCountdowns.set(zone.id, entry);
    }
    if (entry.text !== text) {
      entry.text = text;
      const { context, canvas, texture } = entry;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(17, 24, 39, 0.82)";
      context.beginPath();
      context.roundRect(0, 0, canvas.width, canvas.height, 32);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "600 30px Inter, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
      texture.needsUpdate = true;
    }
    this.scheduleCountdownRefresh();
    return entry.sprite;
  }

  /** One shared timer for every countdown on the board; textures only change once a minute. */
  private scheduleCountdownRefresh() {
    if (this.countdownTimer !== null || this.disposed) return;
    this.countdownTimer = setInterval(() => {
      if (this.disposed) return;
      let live = false;
      for (const [id, zone] of this.zoneData) {
        if (!this.zoneCountdowns.has(id)) continue;
        if (zoneCountdownText(zone)) live = true;
        this.ensureZoneCountdown(zone);
      }
      if (!live && this.countdownTimer !== null) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      this.requestRepaint();
    }, 30_000);
  }

  private disposeZoneBeacon(group: THREE.Group) {
    for (const child of group.children) {
      if (child.userData.zoneProcedural) disposeObjectResources(child);
    }
  }

  syncQuests(quests: GameQuest[]) {
    const seen = new Set<string>();
    let removed = false;
    for (const quest of quests) {
      seen.add(quest.id);
      if (this.questProps.has(quest.id)) continue;
      const group = new THREE.Group();
      group.userData = { lng: quest.lng, lat: quest.lat, questId: quest.id };
      this.positionObject(group, quest.lng, quest.lat, 0);
      this.questProps.set(quest.id, group);
      this.scene.add(group);
      // A shared procedural marker is both clearer than a field of unrelated treasure chests and
      // avoids downloading/decoding/cloning the same GLB seven times during game startup.
      const marker = new THREE.Mesh(this.questGeometry, this.questMaterial);
      marker.position.z = 4;
      marker.rotation.z = Math.PI / 4;
      if (this.opacity < 1) this.applyOpacityTo(marker);
      group.add(marker);
    }
    for (const [id, group] of this.questProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.questProps.delete(id);
        removed = true;
      }
    }
    if (removed) this.requestRepaint();
  }

  syncEncounters(encounters: GameEncounter[]) {
    const seen = new Set<string>();
    let removed = false;
    for (const enc of encounters) {
      seen.add(enc.id);
      if (this.encounterProps.has(enc.id)) continue;
      const group = new THREE.Group();
      group.userData = { lng: enc.lng, lat: enc.lat, encounterId: enc.id };
      this.positionObject(group, enc.lng, enc.lat, 0);
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
        if (this.opacity < 1) this.applyOpacityTo(instance.root);
        group.add(instance.root);
        this.requestRepaint();
      });
    }
    for (const [id, group] of this.encounterProps) {
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.encounterProps.delete(id);
        removed = true;
      }
    }
    if (removed) this.requestRepaint();
  }

  removeEncounter(id: string) {
    const group = this.encounterProps.get(id);
    if (!group) return;
    this.scene.remove(group);
    this.encounterProps.delete(id);
    this.requestRepaint();
  }

  syncGhosts(ghosts: GameGhost[]) {
    const seen = new Set<string>();
    let removed = false;
    for (const ghost of ghosts) {
      seen.add(ghost.id);
      if (this.ghostSprites.has(ghost.id)) continue;
      const placeholder = createPlaceholderGhostSprite();
      placeholder.userData = { lng: ghost.lng, lat: ghost.lat, ghostId: ghost.id };
      this.positionObject(placeholder, ghost.lng, ghost.lat, 6);
      if (this.opacity < 1) this.applyOpacityTo(placeholder);
      this.ghostSprites.set(ghost.id, placeholder);
      this.scene.add(placeholder);
    }
    for (const [id, sprite] of this.ghostSprites) {
      if (!seen.has(id)) {
        this.scene.remove(sprite);
        disposeSprite(sprite);
        this.ghostSprites.delete(id);
        removed = true;
      }
    }
    if (removed) this.requestRepaint();
  }

  removeGhost(id: string) {
    const sprite = this.ghostSprites.get(id);
    if (!sprite) return;
    this.scene.remove(sprite);
    disposeSprite(sprite);
    this.ghostSprites.delete(id);
    this.requestRepaint();
  }

  /** What the scene is currently holding. The game draws into a custom WebGL layer, so this is the
   *  only way an end-to-end test can ask whether the player and their dots are actually there. */
  get contents() {
    return {
      orbs: this.orbData.size,
      zones: this.zoneProps.size,
      ghosts: this.ghostSprites.size,
      quests: this.questProps.size,
      hasPlayer: Boolean(this.playerLngLat && this.playerRoot),
      avatarStyle: this.avatarStyle,
      playerVisible: Boolean(
        this.avatarStyle === "cube" &&
        this.playerRoot?.visible &&
        this.playerVisualKind === "legacy"
      ),
      hasGotchiAvatar: Boolean(
        this.avatarStyle === "aavegotchi" && this.playerRoot?.visible && this.playerVisualKind
      ),
      avatarVisualKind: this.playerVisualKind,
      avatarLod: this.avatarLod,
      isAssetBackedAvatar: this.playerVisualKind === "asset-glb"
    };
  }

  /** Compatibility/diagnostic view used by browser tests without exposing the rest of the
   * mutable Three.js scene graph. */
  get projectionCamera() {
    return this.camera;
  }

  /** Concise, player-relevant state for the deterministic web-game test client. */
  get textState() {
    const player = this.playerLngLat;
    return {
      coordinateSystem: "WGS84 lng/lat; x=east, y=north; distances are metres",
      avatar: this.avatarStyle,
      avatarAsset: {
        selectionId: this.avatarSelection.inventoryItemId,
        selectionSource: this.avatarSelection.source,
        resolution: this.liveAvatarUrl ? "asset-glb" : this.avatarResolution.kind,
        fallbackReason:
          this.avatarResolution.kind === "neutral-placeholder"
            ? this.avatarResolution.reason
            : null,
        lod: this.avatarLod,
        animation: this.playerAnimationState,
        loadMs: this.avatarLoadMs,
        loadError: this.avatarLoadError,
        sourceMetadataEvidence:
          this.avatarResolution.kind === "asset-glb"
            ? this.avatarResolution.descriptor.licence.evidencePath
            : null,
        hasAssetPayload: this.playerVisualKind === "asset-glb"
      },
      player,
      counts: this.contents,
      performanceTier: this.performanceTier,
      performance: this.performanceMonitor.snapshot(this.performanceTier),
      zones: [...this.zoneData.values()].map((zone) => ({
        id: zone.id,
        name: zone.name,
        kind: zone.zoneKind ?? "standard",
        lifecycle: zone.lifecycle ?? "active",
        lng: zone.lng,
        lat: zone.lat,
        radiusM: zone.radiusM,
        endsInSeconds: zone.endsInSeconds ?? null,
        minStakeUsd: zone.minStakeUsd ?? 0
      })),
      visibleOrbs: [...this.orbData.entries()].slice(0, 24).map(([id, data]) => {
        return {
          id,
          lng: data.lng,
          lat: data.lat,
          distanceM: player ? Math.round(haversineM(player, data)) : null,
          towards: data.towards ?? null
        };
      })
    };
  }

  syncOrbs(orbs: GameOrb[]) {
    this.orbData = new Map(orbs.slice(0, MAX_ORBS).map((orb) => [orb.id, orb]));
    this.renderOrbInstances();
    this.requestRepaint();
  }

  collectNearbyOrbs(maxM = 8): string[] {
    if (!this.playerLngLat) return [];
    const collected: string[] = [];
    for (const [id, orb] of this.orbData) {
      const { lng, lat } = orb;
      if (haversineM(this.playerLngLat, { lng, lat }) <= maxM) collected.push(id);
    }
    for (const id of collected) this.orbData.delete(id);
    if (collected.length) {
      this.renderOrbInstances();
      this.requestRepaint();
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

  render(matrix: ArrayLike<number>) {
    if (!this.anchor || this.disposed) return;

    const zoomBand = Math.floor(this.map.getZoom() * 2);
    if (zoomBand !== this.lastAvatarZoomBand) {
      this.lastAvatarZoomBand = zoomBand;
      if (!this.liveAvatarUrl) this.ensureAvatarAssetForZoom();
    }

    const scale = this.anchor.merc.meterInMercatorCoordinateUnits();
    this.camera.projectionMatrix.fromArray(matrix as number[]);
    this.projectionTranslate.makeTranslation(
      this.anchor.merc.x,
      this.anchor.merc.y,
      this.anchor.merc.z ?? 0
    );
    this.projectionScale.makeScale(scale, -scale, scale);
    this.camera.projectionMatrix.multiply(this.projectionTranslate).multiply(this.projectionScale);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const now = performance.now();
    const dt = this.lastRenderAt === 0 ? 0.016 : Math.min((now - this.lastRenderAt) / 1000, 0.1);
    this.lastRenderAt = now;

    let positionMoving = false;
    let headingMoving = false;
    if (this.playerLngLat && this.playerDisplayReady) {
      const distanceSq = this.playerDisplayPosition.distanceToSquared(this.playerTargetPosition);
      if (distanceSq > PLAYER_SETTLE_DISTANCE_SQ) {
        this.playerDisplayPosition.lerp(this.playerTargetPosition, PLAYER_POSITION_LERP);
        positionMoving = true;
      } else {
        this.playerDisplayPosition.copy(this.playerTargetPosition);
      }
      this.playerMarker.position.set(
        this.playerDisplayPosition.x,
        this.playerDisplayPosition.y,
        0.08
      );
      if (this.playerRoot) {
        this.playerRoot.position.copy(this.playerDisplayPosition);
        if (this.liveAvatarUrl) {
          this.playerRoot.position.z += 1.5 + Math.sin(now / 650) * 0.65;
          this.playerRoot.rotation.x =
            now < this.avatarInteractionUntil ? -0.1 : positionMoving ? 0.07 : 0;
        }
      }

      const headingDelta = Math.atan2(
        Math.sin(this.playerTargetHeading - this.playerHeading),
        Math.cos(this.playerTargetHeading - this.playerHeading)
      );
      if (Math.abs(headingDelta) > PLAYER_SETTLE_HEADING) {
        headingMoving = true;
      } else {
        this.playerHeading = this.playerTargetHeading;
      }
      this.playerHeading = lerpAngle(
        this.playerHeading,
        this.playerTargetHeading,
        PLAYER_HEADING_LERP
      );
      if (this.playerRoot) this.playerRoot.rotation.z = this.playerHeading;
    }
    this.setPlayerMoving(positionMoving);
    const interacting = now < this.avatarInteractionUntil;
    if (!interacting && this.playerAnimationState !== (positionMoving ? "walk" : "idle")) {
      this.applyAvatarAnimation(positionMoving ? "walk" : "idle");
    }
    if (positionMoving || interacting) {
      this.playerMixer?.update(dt);
      this.neutralAvatar?.update(dt);
    }

    const renderStartedAt = performance.now();
    this.renderer.resetState();
    this.renderer.clearDepth();
    this.worldObjects?.update(
      performance.now(),
      this.map.getCanvas().ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)")
        .matches ?? false
    );
    this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info;
    const visibleEntities =
      (this.worldObjects?.count ?? 0) +
      this.orbData.size +
      this.zoneProps.size +
      this.questProps.size +
      this.encounterProps.size +
      this.ghostSprites.size +
      (this.playerRoot ? 1 : 0);
    this.performanceMonitor.record({
      frameMs: Math.max(0, performance.now() - renderStartedAt),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      visibleEntities
    });

    if (positionMoving || headingMoving || interacting || this.worldObjects)
      this.requestAnimationRepaint();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.worldObjects?.destroy();
    this.avatarRequest += 1;
    if (this.repaintTimer) {
      clearTimeout(this.repaintTimer);
      this.repaintTimer = null;
    }
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    for (const entry of this.zoneCountdowns.values()) disposeObjectResources(entry.sprite);
    this.zoneCountdowns.clear();
    this.playerMixer?.stopAllAction();

    // Cached GLB instances share their materials. Restore their base opacity before releasing the
    // scene so a later activation never inherits an old layer-slider value.
    if (this.opacity !== 1) {
      this.opacity = 1;
      this.applyOpacityTo(this.scene);
    }
    for (const sprite of this.ghostSprites.values()) disposeSprite(sprite);
    for (const group of this.zoneProps.values()) this.disposeZoneBeacon(group);
    disposeObjectResources(this.playerMarker);
    this.orbSphereMesh.dispose();
    this.orbHaloMesh.dispose();
    this.orbSphereGeometry.dispose();
    this.orbSphereMaterial.dispose();
    this.orbHaloGeometry.dispose();
    this.orbHaloMaterial.dispose();
    this.questGeometry.dispose();
    this.questMaterial.dispose();
    if (this.neutralAvatar) this.neutralAvatar.dispose();
    else if (this.playerRoot && this.playerOwnsResources) disposeObjectResources(this.playerRoot);

    this.scene.clear();
    this.zoneProps.clear();
    this.zoneData.clear();
    this.questProps.clear();
    this.encounterProps.clear();
    this.ghostSprites.clear();
    this.orbData.clear();
    this.renderer.dispose();
  }
}
