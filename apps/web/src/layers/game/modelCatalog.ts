import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * GLB catalog for the game layer, ported from the original QuestLayer engine.
 *
 * Three constraints shape this file:
 * 1. We share MapLibre's WebGL context. PBR shaders (MeshStandardMaterial)
 *    intermittently fail to link there, so every material is downgraded to
 *    Lambert/Basic on load.
 * 2. Models are authored y-up; our world space is z-up (x=east, y=north).
 *    `instantiate` returns a root whose `rotation.z` is a world-space yaw.
 * 3. Loading is async but rendering is not: callers get nothing until the GLB
 *    resolves — `preloadModels` warms the cache without blocking a frame.
 */

export interface ModelSpec {
  url: string;
  /** Model is scaled uniformly so its bounding box reaches this height in meters. */
  targetHeight: number;
  /** Extra yaw applied in model space so the model faces +north at yaw 0. */
  yawOffset?: number;
  /** Animated models are skeleton-cloned and get an AnimationMixer. */
  animated?: boolean;
}

export const MODELS = {
  player: {
    url: "/models/cube-guy-character.glb",
    // A map-game avatar needs to remain legible from the follow camera without towering over
    // the 1:1 buildings it walks between. Five metres reads as a character, not a kaiju.
    targetHeight: 5.2,
    yawOffset: Math.PI,
    animated: true
  },

  tree: { url: "/models/tree.glb", targetHeight: 14 },
  treeA: { url: "/models/tree-a.glb", targetHeight: 15 },
  treeB: { url: "/models/tree-b.glb", targetHeight: 13 },
  deadTree: { url: "/models/dead-tree.glb", targetHeight: 13 },
  bush: { url: "/models/bush.glb", targetHeight: 6 },
  bamboo: { url: "/models/bamboo.glb", targetHeight: 12 },
  flowers: { url: "/models/flowers.glb", targetHeight: 5 },
  mushroom: { url: "/models/mushroom.glb", targetHeight: 6 },
  crystal: { url: "/models/crystal.glb", targetHeight: 9 },
  bigCrystal: { url: "/models/big-crystal.glb", targetHeight: 13 },
  diamondBlock: { url: "/models/diamond-block.glb", targetHeight: 8 },

  chest: { url: "/models/wood-chest.glb", targetHeight: 6 },
  chestOpen: { url: "/models/chest-open.glb", targetHeight: 6 },
  key: { url: "/models/key.glb", targetHeight: 5 },

  demon: { url: "/models/demon.glb", targetHeight: 10, animated: true },
  goblin: { url: "/models/goblin.glb", targetHeight: 8, animated: true },
  wolf: { url: "/models/wolf.glb", targetHeight: 7, animated: true },
  giant: { url: "/models/giant.glb", targetHeight: 12, animated: true },
  chicken: { url: "/models/chicken.glb", targetHeight: 5, animated: true },
  hedgehog: { url: "/models/hedgehog.glb", targetHeight: 4, animated: true }
} satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

/** Zone prop pools per OSM POI category — variety without any runtime randomness. */
const ZONE_POOLS: Partial<Record<string, ModelKey[]>> = {
  viewpoint: ["crystal", "bigCrystal", "treeA"],
  peak: ["crystal", "bigCrystal", "deadTree"],
  waterfall: ["bamboo", "bush", "treeB"],
  lake: ["bamboo", "bush", "flowers"],
  castle: ["diamondBlock", "chest", "bigCrystal"],
  palace: ["diamondBlock", "chest", "flowers"],
  ruins: ["deadTree", "mushroom", "crystal"],
  museum: ["chest", "key", "diamondBlock"],
  monument: ["crystal", "deadTree", "key"],
  camp_site: ["tree", "bush", "flowers"]
};
const ZONE_POOL_FALLBACK: ModelKey[] = ["crystal", "bush", "mushroom", "treeA"];

export function pickZoneModelKey(seed: number, category: string | null | undefined): ModelKey {
  const pool = (category && ZONE_POOLS[category]) || ZONE_POOL_FALLBACK;
  return pool[seed % pool.length]!;
}

// ---------- loading ----------

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Uniform scale that brings the model to `targetHeight`. */
  scale: number;
  /** Vertical offset so the model's feet sit at z=0 after scaling. */
  groundOffset: number;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel | null>>();

export function loadModel(key: ModelKey): Promise<LoadedModel | null> {
  return loadModelSpec(`catalog:${key}`, MODELS[key] as ModelSpec);
}

/** Generic, cache-keyed GLB loader used after local-URL and performance checks have passed. It
 * performs no URL policy itself; callers must validate first. */
export function loadModelSpec(cacheKey: string, spec: ModelSpec): Promise<LoadedModel | null> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const promise = loader
    .loadAsync(spec.url)
    .then((gltf) => {
      const scene = gltf.scene;
      downgradeMaterials(scene);
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const height = Math.max(size.y, 0.001);
      const scale = spec.targetHeight / height;
      return {
        scene,
        animations: gltf.animations ?? [],
        scale,
        groundOffset: -box.min.y * scale
      };
    })
    .catch(() => null);
  cache.set(cacheKey, promise);
  return promise;
}

/** Warms the cache for models we know we will need, without blocking a frame. */
export function preloadModels(keys: ModelKey[]) {
  for (const key of keys) void loadModel(key);
}

export interface ModelInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
}

export function instantiate(loaded: LoadedModel, key: ModelKey): ModelInstance {
  return instantiateModel(loaded, MODELS[key] as ModelSpec);
}

export function instantiateModel(loaded: LoadedModel, spec: ModelSpec): ModelInstance {
  const root = new THREE.Group();
  const visual = new THREE.Group();
  visual.rotation.x = Math.PI / 2;
  visual.rotation.y = spec.yawOffset ?? 0;
  visual.scale.setScalar(loaded.scale);
  root.add(visual);
  root.position.z = 0;

  const model = spec.animated ? cloneSkeleton(loaded.scene) : loaded.scene.clone(true);
  model.position.y = 0;
  visual.add(model);
  visual.position.z = loaded.groundOffset;

  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  if (spec.animated && loaded.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    for (const clip of loaded.animations) {
      actions.set(clip.name.toLowerCase(), mixer.clipAction(stripRootMotion(clip)));
    }
  }
  return { root, mixer, actions };
}

/** Picks the first available action from a preference list, falling back to whatever exists —
 * walk cycle naming varies a lot between free GLB assets. */
export function pickAction(
  actions: Map<string, THREE.AnimationAction>,
  preferred: string[]
): THREE.AnimationAction | null {
  for (const want of preferred) {
    for (const [name, action] of actions) {
      if (name.includes(want)) return action;
    }
  }
  return actions.values().next().value ?? null;
}

function downgradeMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material;
    const convert = (mat: THREE.Material): THREE.Material => {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std.isMaterial) return mat;
      if (mat.type !== "MeshStandardMaterial" && mat.type !== "MeshPhysicalMaterial") return mat;
      const next = new THREE.MeshLambertMaterial({
        color: std.color?.clone() ?? new THREE.Color(0xffffff),
        map: std.map ?? null,
        emissive: std.emissive?.clone() ?? new THREE.Color(0x000000),
        emissiveMap: std.emissiveMap ?? null,
        transparent: std.transparent,
        opacity: std.opacity,
        side: std.side,
        alphaTest: std.alphaTest,
        vertexColors: std.vertexColors
      });
      next.name = std.name;
      return next;
    };
    mesh.material = Array.isArray(source) ? source.map(convert) : convert(source);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

/** Removes root translation tracks so walk cycles animate in place — the map, not the
 * animation, owns the character's position. */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const filtered = clip.tracks.filter((track) => {
    if (!track.name.endsWith(".position")) return true;
    const node = track.name.slice(0, -".position".length).toLowerCase();
    return !(node.includes("root") || node.includes("hips") || node.includes("armature"));
  });
  if (filtered.length === clip.tracks.length) return clip;
  const next = clip.clone();
  next.tracks = filtered;
  return next;
}
