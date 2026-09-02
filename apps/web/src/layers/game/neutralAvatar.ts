import * as THREE from "three";
import type { AvatarAnimationState, GamePerformanceTier } from "./avatarAssets";

export interface NeutralAvatarInstance {
  root: THREE.Group;
  setAnimation(state: AvatarAnimationState): void;
  update(deltaSeconds: number): void;
  readonly animation: AvatarAnimationState;
  readonly diagnostics: {
    source: "mapos-procedural";
    triangles: number;
    drawCalls: number;
    estimatedGpuBytes: number;
  };
  dispose(): void;
}

/**
 * Original MapOS geometry with no third-party artwork, texture or trademark. It is deliberately
 * character-like but not Gotchi-like, so the asset gate stays honest while the real GLB pipeline
 * can be exercised end to end.
 */
export function createNeutralAvatar(tier: GamePerformanceTier): NeutralAvatarInstance {
  const root = new THREE.Group();
  root.name = "MapOS neutral 3D placeholder";
  const visual = new THREE.Group();
  visual.position.z = 3.2;
  root.add(visual);

  const radialSegments = tier === "low" ? 6 : 10;
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xb7791f });
  const accentMaterial = new THREE.MeshLambertMaterial({ color: 0x21d4b4 });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x2d2926 });
  const materials = [bodyMaterial, accentMaterial, darkMaterial];
  const geometries: THREE.BufferGeometry[] = [];

  const bodyGeometry = new THREE.CylinderGeometry(1.05, 1.3, 2.7, radialSegments);
  const headGeometry = new THREE.SphereGeometry(
    1.05,
    radialSegments,
    Math.max(4, radialSegments - 2)
  );
  const limbGeometry = new THREE.CylinderGeometry(0.24, 0.31, 2.1, radialSegments);
  const eyeGeometry = new THREE.SphereGeometry(0.13, 6, 4);
  geometries.push(bodyGeometry, headGeometry, limbGeometry, eyeGeometry);

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.15;
  visual.add(body);

  const head = new THREE.Mesh(headGeometry, accentMaterial);
  head.position.z = 2.35;
  visual.add(head);

  const eyeLeft = new THREE.Mesh(eyeGeometry, darkMaterial);
  eyeLeft.position.set(-0.36, -0.94, 2.48);
  const eyeRight = eyeLeft.clone();
  eyeRight.position.x = 0.36;
  visual.add(eyeLeft, eyeRight);

  const createLimb = (x: number, y: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(limbGeometry, bodyMaterial);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -0.92;
    pivot.add(mesh);
    visual.add(pivot);
    return pivot;
  };

  const armLeft = createLimb(-1.28, 0, 0.75);
  const armRight = createLimb(1.28, 0, 0.75);
  const legLeft = createLimb(-0.55, 0, -1.28);
  const legRight = createLimb(0.55, 0, -1.28);

  let animation: AvatarAnimationState = "idle";
  let phase = 0;

  const setAnimation = (state: AvatarAnimationState) => {
    if (state === animation) return;
    animation = state;
    phase = 0;
  };

  const update = (deltaSeconds: number) => {
    phase += Math.max(0, Math.min(0.1, deltaSeconds));
    visual.position.z = 3.2;
    visual.rotation.x = 0;
    head.rotation.set(0, 0, 0);
    for (const limb of [armLeft, armRight, legLeft, legRight]) limb.rotation.set(0, 0, 0);

    if (animation === "walk" || animation === "run") {
      const speed = animation === "run" ? 12 : 8;
      const amplitude = animation === "run" ? 0.75 : 0.52;
      const swing = Math.sin(phase * speed) * amplitude;
      armLeft.rotation.x = swing;
      armRight.rotation.x = -swing;
      legLeft.rotation.x = -swing;
      legRight.rotation.x = swing;
      visual.position.z += Math.abs(Math.sin(phase * speed)) * 0.11;
    } else if (animation === "collect") {
      const reach = Math.sin(Math.min(1, phase * 2.4) * Math.PI) * 1.05;
      armLeft.rotation.x = -reach;
      armRight.rotation.x = -reach;
      visual.rotation.x = Math.sin(Math.min(1, phase * 2) * Math.PI) * 0.14;
    } else if (animation === "interact") {
      armRight.rotation.x = -0.75;
      armRight.rotation.z = Math.sin(phase * 12) * 0.45;
      head.rotation.z = Math.sin(phase * 6) * 0.08;
    }
  };

  const geometryTriangles = (geometry: THREE.BufferGeometry) => {
    const index = geometry.getIndex();
    return index ? index.count / 3 : geometry.getAttribute("position").count / 3;
  };
  // Count every rendered mesh, including clones which intentionally share their geometry.
  const triangles =
    geometryTriangles(bodyGeometry) +
    geometryTriangles(headGeometry) +
    geometryTriangles(limbGeometry) * 4 +
    geometryTriangles(eyeGeometry) * 2;

  return {
    root,
    setAnimation,
    update,
    get animation() {
      return animation;
    },
    diagnostics: {
      source: "mapos-procedural",
      triangles: Math.round(triangles),
      drawCalls: 8,
      estimatedGpuBytes: 160_000
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.clear();
    }
  };
}
