export type AvatarAnimationState = "idle" | "walk" | "run" | "collect" | "interact";
export type AvatarLodLevel = "lod0" | "lod1" | "lod2";
export type GamePerformanceTier = "low" | "balanced";

export interface AvatarAssetLicence {
  status: "approved" | "pending";
  sourceUrl: string;
  licenceId: string;
  evidencePath: string;
  attribution: string;
  redistributionAllowed: boolean;
  modificationAllowed: boolean;
  commercialUseAllowed: boolean;
}

export interface AvatarLodAsset {
  level: AvatarLodLevel;
  /** Public, same-origin path. Remote binaries never enter the renderer through this contract. */
  url: string;
  bytes: number;
  triangles: number;
  textureBytes: number;
  drawCalls: number;
}

export interface AvatarAssetDescriptor {
  id: string;
  version: string;
  displayName: string;
  kind: "glb";
  targetHeightM: number;
  lods: AvatarLodAsset[];
  animations: Partial<Record<AvatarAnimationState, string[]>>;
  licence: AvatarAssetLicence;
}

export interface AvatarInventorySelection {
  inventoryItemId: string;
  displayName: string;
  source: "neutral-placeholder" | "fixture" | "verified-inventory";
  /** A display/reference value only. It is never proof of ownership. */
  tokenReference?: string;
  assetId?: string;
}

export interface AvatarAssetBudget {
  maxPayloadBytes: number;
  maxTriangles: number;
  maxTextureBytes: number;
  maxDrawCalls: number;
}

export const AVATAR_ASSET_BUDGETS: Record<GamePerformanceTier, AvatarAssetBudget> = {
  low: {
    maxPayloadBytes: 750_000,
    maxTriangles: 15_000,
    maxTextureBytes: 8 * 1024 * 1024,
    maxDrawCalls: 6
  },
  balanced: {
    maxPayloadBytes: 1_500_000,
    maxTriangles: 35_000,
    maxTextureBytes: 16 * 1024 * 1024,
    maxDrawCalls: 10
  }
};

export const NEUTRAL_AVATAR_SELECTION: AvatarInventorySelection = {
  inventoryItemId: "mapos-neutral-3d",
  displayName: "Neutrální 3D průzkumník",
  source: "neutral-placeholder"
};

export type AvatarAssetResolution =
  | {
      kind: "asset-glb";
      selection: AvatarInventorySelection;
      descriptor: AvatarAssetDescriptor;
    }
  | {
      kind: "neutral-placeholder";
      selection: AvatarInventorySelection;
      reason: "no-asset" | "unknown-asset" | "budget-gate";
    };

function safeLocalAvatarUrl(value: string): boolean {
  return (
    value.startsWith("/models/avatars/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

export function validateAvatarAssetDescriptor(
  descriptor: AvatarAssetDescriptor,
  tier: GamePerformanceTier = "balanced"
): string[] {
  const errors: string[] = [];
  if (!descriptor.id.trim()) errors.push("asset id is required");
  if (!/^\d+\.\d+\.\d+$/.test(descriptor.version)) errors.push("version must be semver");
  if (!(descriptor.targetHeightM > 0 && descriptor.targetHeightM <= 10)) {
    errors.push("target height must be between 0 and 10 metres");
  }
  if (!descriptor.lods.length) errors.push("at least one LOD is required");

  const levels = new Set<AvatarLodLevel>();
  const budget = AVATAR_ASSET_BUDGETS[tier];
  for (const lod of descriptor.lods) {
    if (levels.has(lod.level)) errors.push(`duplicate ${lod.level}`);
    levels.add(lod.level);
    if (!safeLocalAvatarUrl(lod.url)) errors.push(`${lod.level} must use a safe local avatar URL`);
    if (lod.bytes <= 0 || lod.bytes > budget.maxPayloadBytes) {
      errors.push(`${lod.level} exceeds the ${tier} payload budget`);
    }
    if (lod.triangles <= 0 || lod.triangles > budget.maxTriangles) {
      errors.push(`${lod.level} exceeds the ${tier} triangle budget`);
    }
    if (lod.textureBytes < 0 || lod.textureBytes > budget.maxTextureBytes) {
      errors.push(`${lod.level} exceeds the ${tier} texture budget`);
    }
    if (lod.drawCalls <= 0 || lod.drawCalls > budget.maxDrawCalls) {
      errors.push(`${lod.level} exceeds the ${tier} draw-call budget`);
    }
  }

  for (const required of ["idle", "walk"] as const) {
    if (!descriptor.animations[required]?.some((name) => name.trim())) {
      errors.push(`${required} animation mapping is required`);
    }
  }
  return errors;
}

function lodOrder(level: AvatarLodLevel): number {
  if (level === "lod0") return 0;
  if (level === "lod1") return 1;
  return 2;
}

/** Selects quality without guessing an absent level. Low-power mode never selects LOD0. */
export function selectAvatarLod(
  descriptor: AvatarAssetDescriptor,
  tier: GamePerformanceTier,
  zoom: number
): AvatarLodAsset {
  const sorted = [...descriptor.lods].sort((a, b) => lodOrder(a.level) - lodOrder(b.level));
  const desired =
    tier === "low"
      ? zoom >= 17
        ? "lod1"
        : "lod2"
      : zoom >= 18
        ? "lod0"
        : zoom >= 16
          ? "lod1"
          : "lod2";
  const exact = sorted.find((lod) => lod.level === desired);
  if (exact) return exact;

  const desiredRank = lodOrder(desired);
  return (
    [...sorted]
      .sort(
        (a, b) =>
          Math.abs(lodOrder(a.level) - desiredRank) - Math.abs(lodOrder(b.level) - desiredRank)
      )
      .at(0) ??
      // Descriptor validation already prevents this branch; keeping it total makes the renderer
      // resilient to a future untrusted adapter accidentally bypassing validation.
      {
        level: "lod2",
        url: "",
        bytes: 0,
        triangles: 0,
        textureBytes: 0,
        drawCalls: 0
      }
  );
}

export interface AvatarAssetProvider {
  resolve(selection: AvatarInventorySelection, tier: GamePerformanceTier): AvatarAssetResolution;
}

export function createAvatarAssetProvider(
  descriptors: readonly AvatarAssetDescriptor[]
): AvatarAssetProvider {
  const catalog = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  return {
    resolve(selection, tier) {
      if (!selection.assetId) {
        return { kind: "neutral-placeholder", selection, reason: "no-asset" };
      }
      const descriptor = catalog.get(selection.assetId);
      if (!descriptor) {
        return { kind: "neutral-placeholder", selection, reason: "unknown-asset" };
      }
      const validation = validateAvatarAssetDescriptor(descriptor, tier);
      if (validation.length) {
        return { kind: "neutral-placeholder", selection, reason: "budget-gate" };
      }
      return { kind: "asset-glb", selection, descriptor };
    }
  };
}

/** Empty because the data-efficient v19 payload does not include a model bundle. */
export const defaultAvatarAssetProvider = createAvatarAssetProvider([]);

export function animationCandidates(
  descriptor: AvatarAssetDescriptor,
  state: AvatarAnimationState
): string[] {
  const mapped = descriptor.animations[state] ?? [];
  return mapped.length ? mapped : [state];
}
