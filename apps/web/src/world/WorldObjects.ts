import {
  loadModel,
  loadModelSpec,
  instantiateModel,
  MODELS,
  type ModelKey
} from "../layers/game/modelCatalog";
import { API_BASE } from "../lib/api";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GeoThread, PublicPresence, WorldPosition, WorldSnapshot } from "@mapos/layer-sdk";

/** Entity kinds that have a reviewed GLB in the catalogue. Everything else keeps the procedural
 *  stand-in, which stays the fallback if a model is missing or fails to load. */
const CATALOG_ENTITY_MODEL: Partial<Record<string, ModelKey>> = {
  essence: "bigCrystal",
  boss: "giant",
  lickquidator: "goblin"
};

const colors = [0x5ee3c3, 0xa98aff, 0xffd36e, 0xf995cf];
function model(kind: string, variant = 0): THREE.Group {
  const root = new THREE.Group(),
    pieces: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
    geometry.translate(x, y, z);
    const c = new THREE.Color(color),
      a = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < a.length; i += 3) {
      a[i] = c.r;
      a[i + 1] = c.g;
      a[i + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(a, 3));
    pieces.push(geometry.index ? geometry.toNonIndexed() : geometry);
    geometry.dispose();
  };
  const box = (w: number, d: number, h: number, c: number, x: number, y: number, z: number) =>
    add(new THREE.BoxGeometry(w, d, h), c, x, y, z);
  if (kind === "quest") {
    box(1, 1, 11, 0xffd36e, 0, 0, 5.5);
    box(7, 1, 4, 0xa98aff, 3, 0, 10);
    add(new THREE.TorusGeometry(5, 0.5, 4, 16), 0xffd36e, 0, 0, 0.5);
  } else if (kind === "note") {
    box(3, 3, 9, 0xb994f7, 0, 0, 4.5);
    box(8, 2, 5, 0x8150df, 0, 0, 11);
    box(4, 0.5, 0.5, 0xffffff, 0, -1.3, 11);
    box(2, 0.5, 0.5, 0xffffff, -1, -1.3, 10);
  } else if (kind === "essence") add(new THREE.OctahedronGeometry(3.3), colors[variant]!, 0, 0, 4);
  else if (kind === "chest") {
    box(8, 6, 4, 0x483467, 0, 0, 2);
    const hinge = new THREE.Group();
    hinge.name = "lid";
    hinge.position.set(0, 3, 4);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 6.5, 1.5),
      new THREE.MeshLambertMaterial({ color: 0xb187ec })
    );
    lid.position.set(0, -3, 0.75);
    hinge.add(lid);
    root.add(hinge);
    box(1.2, 6.8, 5, 0xffd36e, 0, 0, 2.5);
    box(2, 1, 2, 0xffedb5, 0, -3.6, 3);
  } else if (kind === "portal") {
    const ring = new THREE.TorusGeometry(9, 1.6, 6, 16);
    ring.rotateX(Math.PI / 2);
    add(ring, 0xa98aff, 0, 0, 11);
    box(24, 6, 2, 0x49325f, 0, 0, 1);
    box(3, 4, 16, 0xd6c1ff, -11, 0, 8);
    box(3, 4, 16, 0xd6c1ff, 11, 0, 8);
  } else if (kind === "coin") {
    // A street coin: standing on its edge so the follow camera reads it as a disc, small and
    // bright so a row of them along a street looks like a trail to follow.
    const face = new THREE.CylinderGeometry(2, 2, 0.45, 16);
    face.rotateX(Math.PI / 2);
    add(face, 0xffd36e, 0, 0, 3);
    add(new THREE.TorusGeometry(2, 0.3, 6, 18), 0xd99a1c, 0, 0, 3);
  } else {
    const boss = kind === "boss",
      ghost = kind === "presence";
    const white = ghost ? 0xe3d9f4 : boss ? 0x452e68 : 0x9cdcca;
    box(7, 5, 6, white, 0, 0, 5);
    box(5, 4.5, 2, white, 0, 0, 9);
    box(2.5, 4, 2, white, -2, 0, 1);
    box(2.5, 4, 2, white, 2, 0, 1);
    box(2, 2.5, 3, white, -4.6, 0, 5);
    box(2, 2.5, 3, white, 4.6, 0, 5);
    box(1.7, 0.6, 2.3, boss ? 0xff658b : 0x6a39af, -1.8, -2.8, 6);
    box(1.7, 0.6, 2.3, boss ? 0xff658b : 0x6a39af, 1.8, -2.8, 6);
    box(0.7, 0.8, 1.3, 0x19152c, -1.6, -3, 6);
    box(0.7, 0.8, 1.3, 0x19152c, 1.6, -3, 6);
    if (!ghost) {
      box(2, 4, 0.9, 0xf18db8, 0, -4.2, 3.8);
      box(4, 1, 0.6, 0x432144, 0, -2.8, 4.2);
    }
    if (boss) {
      for (let i = -1; i <= 1; i++)
        add(new THREE.ConeGeometry(1.4, 4, 4).rotateX(Math.PI / 2), 0xffd36e, i * 2.7, 0, 12);
      root.scale.setScalar(2.2);
    }
  }
  const merged = mergeGeometries(pieces);
  pieces.forEach((g) => g.dispose());
  if (merged)
    root.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true })));
  return root;
}
function dispose(root: THREE.Object3D) {
  if (root.userData.sharedAsset) {
    root.clear();
    return;
  }
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}
/** Original anonymous ghost, with no NFT traits or equipment. */
export function createWorldGhostAvatar(): import("../layers/game/neutralAvatar").NeutralAvatarInstance {
  const root = new THREE.Group(),
    visual = model("presence");
  root.add(visual);
  let animation: import("../layers/game/avatarAssets").AvatarAnimationState = "idle",
    phase = 0;
  return {
    root,
    setAnimation(value) {
      animation = value;
    },
    update(dt) {
      phase += Math.min(0.1, dt);
      visual.position.z = Math.sin(phase * 3) * 0.4;
      visual.rotation.x = animation === "interact" ? Math.sin(phase * 12) * 0.12 : 0;
    },
    get animation() {
      return animation;
    },
    diagnostics: {
      source: "mapos-procedural",
      triangles: 120,
      drawCalls: 1,
      estimatedGpuBytes: 20000
    },
    dispose() {
      dispose(root);
      root.clear();
    }
  };
}
export class WorldObjects {
  readonly root = new THREE.Group();
  private objects = new Map<string, THREE.Group>();
  private positions = new Map<string, WorldPosition>();
  private effects: {
    mesh: THREE.Mesh;
    from: THREE.Vector3;
    to: THREE.Vector3;
    start: number;
    duration: number;
    kind: "bolt" | "fireball" | "burst";
  }[] = [];
  private ray = new THREE.Raycaster();
  // Preallocated so a mousemove hover does not allocate a Vector2 and a fresh array every frame.
  private pickPoint = new THREE.Vector2();
  private pickList: THREE.Object3D[] = [];
  private lastUpdateAt = 0;
  constructor(private local: (lng: number, lat: number) => { x: number; y: number }) {}
  sync(snapshot: WorldSnapshot, presence: PublicPresence[], notes: GeoThread[] = []) {
    const peer = presence
      .filter((p) => p.profile && p.model?.status === "ready")
      .sort(
        (a, b) =>
          Math.hypot(
            a.lng - (snapshot.gamePosition?.lng ?? 0),
            a.lat - (snapshot.gamePosition?.lat ?? 0)
          ) -
          Math.hypot(
            b.lng - (snapshot.gamePosition?.lng ?? 0),
            b.lat - (snapshot.gamePosition?.lat ?? 0)
          )
      )[0];
    const entries = [
      ...(snapshot.arena?.participants
        .filter((p) => !p.self)
        .map((p) => ({
          id: `arena:${p.id}`,
          kind: "presence",
          variant: 0,
          at: p.position,
          hp: 0,
          maxHp: 0
        })) ?? []),
      ...notes.slice(0, 25).map((n) => ({
        id: `note:${n.id}`,
        kind: "note",
        variant: 0,
        at: n,
        hp: 0,
        maxHp: 0
      })),
      ...snapshot.quests
        .filter((q) => !q.completed && q.kind !== "raid")
        .slice(0, 40)
        .map((q) => ({
          id: q.id,
          kind: "quest",
          variant: 0,
          at: q.kind === "trail" ? (q.checkpoints[q.checkpoint] ?? q) : q,
          hp: 0,
          maxHp: 0
        })),
      ...snapshot.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        variant: e.variant,
        at: e,
        hp: e.hp,
        maxHp: e.maxHp
      })),
      ...presence.slice(0, 20).map((p) => ({
        id: `presence:${p.presenceId}`,
        kind: "presence",
        variant: 0,
        at: p,
        hp: 0,
        maxHp: 0
      }))
    ];
    const visible = new Set(entries.map((e) => e.id));
    for (const [id, obj] of this.objects)
      if (!visible.has(id)) {
        if ((obj.userData.collectUntil ?? 0) > performance.now()) continue;
        this.root.remove(obj);
        dispose(obj);
        this.objects.delete(id);
        this.positions.delete(id);
      }
    for (const e of entries) {
      let obj = this.objects.get(e.id);
      if (!obj) {
        obj = model(e.kind, e.variant);
        obj.userData.worldId = e.id;
        obj.userData.kind = e.kind;
        this.objects.set(e.id, obj);
        this.root.add(obj);
        const catalogKey = CATALOG_ENTITY_MODEL[e.kind];
        if (catalogKey) this.attachCatalogModel(e.id, obj, catalogKey);
      }
      if (e.kind === "presence" && e.id.startsWith("presence:")) {
        const publicPeer = presence.find((p) => `presence:${p.presenceId}` === e.id);
        const url =
          publicPeer === peer
            ? (peer.model?.lods?.find((l) => l.level === "low")?.url ?? peer.model?.url)
            : undefined;
        if (obj.userData.modelUrl !== url) {
          dispose(obj);
          this.root.remove(obj);
          obj = model("presence");
          obj.userData.worldId = e.id;
          obj.userData.kind = e.kind;
          obj.userData.modelUrl = url;
          this.objects.set(e.id, obj);
          this.root.add(obj);
          if (url) {
            const target = obj,
              full = `${API_BASE}${url.replace(/^\/api/, "")}`,
              spec = { url: full, targetHeight: 8, animated: true, yawOffset: Math.PI };
            void loadModelSpec(full, spec).then((loaded) => {
              if (!loaded || this.objects.get(e.id) !== target) return;
              dispose(target);
              target.clear();
              const instance = instantiateModel(loaded, spec);
              // A model with a skeleton but no playing action stands still; start the most
              // readable clip so peers animate instead of looking like statues.
              const action =
                instance.actions.get("idle") ??
                instance.actions.get("walk") ??
                [...instance.actions.values()][0];
              action?.reset().fadeIn(0.2).play();
              target.userData.mixer = instance.mixer;
              target.add(instance.root);
              target.userData.sharedAsset = true;
            });
          }
        }
      }
      obj.userData.phase = e.maxHp > 0 && e.hp / e.maxHp < 0.5 ? 2 : 1;
      obj.visible = e.maxHp === 0 || e.hp > 0;
      const p = this.local(e.at.lng, e.at.lat);
      obj.position.set(p.x, p.y, 0);
      // Cache the projected base so update() does not re-project every object every frame.
      obj.userData.baseX = p.x;
      obj.userData.baseY = p.y;
      this.positions.set(e.id, e.at);
      if (e.maxHp > 0) {
        let hp = obj.getObjectByName("hp") as THREE.Mesh | undefined;
        if (!hp) {
          hp = new THREE.Mesh(
            new THREE.BoxGeometry(7, 0.7, 0.7),
            new THREE.MeshBasicMaterial({ color: 0xf7769b })
          );
          hp.name = "hp";
          hp.position.set(0, 0, 15);
          obj.add(hp);
        }
        hp.scale.x = Math.max(0.01, e.hp / e.maxHp);
      }
    }
  }
  update(now: number, reduced: boolean) {
    const dt = this.lastUpdateAt === 0 ? 0.016 : Math.min(0.1, (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    for (const [id, obj] of this.objects) {
      const mixer = obj.userData.mixer as THREE.AnimationMixer | undefined;
      if (mixer) mixer.update(dt);
      if (obj.userData.collectUntil) {
        const remaining = obj.userData.collectUntil - now;
        if (remaining <= 0) {
          obj.visible = false;
          continue;
        }
        const lid = obj.getObjectByName("lid");
        if (lid) lid.rotation.x = (-Math.min(1, (650 - remaining) / 300) * Math.PI) / 2;
        else obj.rotation.z += (650 - remaining) / 20000;
      }
      const baseX = obj.userData.baseX as number | undefined;
      const baseY = obj.userData.baseY as number | undefined;
      if (typeof baseX === "number" && typeof baseY === "number") {
        obj.position.x = baseX;
        obj.position.y = baseY;
      } else {
        const at = this.positions.get(id)!;
        const p = this.local(at.lng, at.lat);
        obj.position.x = p.x;
        obj.position.y = p.y;
      }
      if (!reduced) {
        obj.position.z = Math.sin(now / 650 + obj.id) * 0.5;
        if (obj.userData.kind === "essence") obj.rotation.z = now / 1600;
        if (obj.userData.kind === "coin") obj.rotation.z = now / 520;
        if (obj.userData.kind === "boss" && obj.userData.phase === 2)
          obj.scale.setScalar(2.2 + Math.sin(now / 160) * 0.1);
        if (obj.userData.kind === "lickquidator") obj.rotation.z = Math.sin(now / 1100) * 0.16;
      }
    }
    this.effects = this.effects.filter((effect) => {
      const age = now - effect.start;
      if (age < 0) return true;
      const t = Math.min(1, age / effect.duration);
      if (t >= 1) {
        this.root.remove(effect.mesh);
        dispose(effect.mesh);
        return false;
      }
      if (effect.kind === "burst") {
        effect.mesh.position.copy(effect.to);
        effect.mesh.scale.setScalar(1 + t * 14);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      } else if (effect.kind === "fireball") {
        // A slight arc so a fireball reads as thrown, not slid along the ground.
        effect.mesh.position.lerpVectors(effect.from, effect.to, t);
        effect.mesh.position.z += Math.sin(t * Math.PI) * 6;
        effect.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.35);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      } else effect.mesh.position.lerpVectors(effect.from, effect.to, t);
      return true;
    });
  }
  /** Replace a procedural stand-in with the catalogue GLB once it loads, keeping the wrapper so
   *  position, rotation, hover and pick keep working. A missing/failed model leaves the stand-in. */
  private attachCatalogModel(id: string, target: THREE.Group, key: ModelKey) {
    void loadModel(key).then((loaded) => {
      if (!loaded || this.objects.get(id) !== target) return;
      const instance = instantiateModel(loaded, MODELS[key]);
      const action =
        instance.actions.get("idle") ??
        instance.actions.get("walk") ??
        [...instance.actions.values()][0];
      action?.reset().fadeIn(0.2).play();
      // Detach the HP bar first: disposing the stand-in must not dispose a bar we still need, and
      // clearing the wrapper would otherwise drop it until the next snapshot re-adds it.
      const hp = target.getObjectByName("hp");
      if (hp) hp.removeFromParent();
      dispose(target);
      target.clear();
      target.add(instance.root);
      if (hp) target.add(hp);
      target.userData.mixer = instance.mixer;
      target.userData.sharedAsset = true;
    });
  }
  private spawnEffect(
    mesh: THREE.Mesh,
    from: THREE.Vector3,
    to: THREE.Vector3,
    start: number,
    duration: number,
    kind: "bolt" | "fireball" | "burst"
  ) {
    mesh.position.copy(from);
    this.root.add(mesh);
    this.effects.push({ mesh, from, to, start, duration, kind });
  }
  effect(type: string, targetId: string, player: WorldPosition | null) {
    if (!["shoot", "cast", "collect"].includes(type)) return;
    const target = this.positions.get(targetId);
    if (!target || !player) return;
    if (type === "collect") {
      const object = this.objects.get(targetId);
      if (object) object.userData.collectUntil = performance.now() + 650;
    }
    const now = performance.now(),
      a = this.local(player.lng, player.lat),
      b = this.local(target.lng, target.lat);
    if (type === "cast") {
      // The server resolves the damage; this is the fireball the caster sees fly.
      this.spawnEffect(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, depthWrite: false })
        ),
        new THREE.Vector3(a.x, a.y, 5),
        new THREE.Vector3(b.x, b.y, 2.5),
        now,
        420,
        "fireball"
      );
      this.spawnEffect(
        new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.22, 6, 24),
          new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false })
        ),
        new THREE.Vector3(b.x, b.y, 2),
        new THREE.Vector3(b.x, b.y, 2),
        now + 380,
        520,
        "burst"
      );
      return;
    }
    const mesh = new THREE.Mesh(
      type === "collect"
        ? new THREE.TorusGeometry(1, 0.15, 6, 24)
        : new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshBasicMaterial({
        color: type === "collect" ? 0xffd36e : 0x5ee3c3,
        transparent: true,
        opacity: 1,
        depthWrite: false
      })
    );
    this.spawnEffect(
      mesh,
      new THREE.Vector3(a.x, a.y, 5),
      new THREE.Vector3(b.x, b.y, type === "collect" ? 1 : 5),
      now,
      type === "collect" ? 700 : 400,
      type === "collect" ? "burst" : "bolt"
    );
  }
  /** Id of the world object under a normalised pointer position, for hover feedback. */
  hover(x: number, y: number, camera: THREE.Camera) {
    return this.pick(x, y, camera);
  }
  pick(x: number, y: number, camera: THREE.Camera) {
    this.pickPoint.set(x, y);
    this.ray.setFromCamera(this.pickPoint, camera);
    this.pickList.length = 0;
    for (const obj of this.objects.values()) this.pickList.push(obj);
    const hit = this.ray.intersectObjects(this.pickList, true)[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node) {
      if (node.userData.worldId) return node.userData.worldId as string;
      node = node.parent;
    }
    return null;
  }
  get count() {
    return this.objects.size;
  }
  destroy() {
    for (const obj of this.objects.values()) dispose(obj);
    for (const e of this.effects) dispose(e.mesh);
    this.objects.clear();
    this.root.clear();
  }
}
