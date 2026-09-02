import { NEUTRAL_AVATAR_SELECTION, type AvatarInventorySelection } from "./avatarAssets";

export interface AvatarInventoryItem {
  selection: AvatarInventorySelection;
  status: "available" | "asset-gated";
  description: string;
}

export interface AvatarInventoryResult {
  source: "local-placeholder" | "fixture" | "verified-provider";
  simulated: boolean;
  items: AvatarInventoryItem[];
  message: string;
}

/** Renderer-neutral boundary. Wallet/indexer adapters can implement it without importing Three.js. */
export interface AvatarInventoryProvider {
  list(signal?: AbortSignal): Promise<AvatarInventoryResult>;
}

const SELECTION_STORAGE_KEY = "mapos:game-avatar-selection-v1";

export const placeholderAvatarInventoryProvider: AvatarInventoryProvider = {
  async list(signal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      source: "local-placeholder",
      simulated: false,
      items: [
        {
          selection: NEUTRAL_AVATAR_SELECTION,
          status: "available",
          description: "Vlastní procedurální 3D model MapOS; neobsahuje Aavegotchi artwork."
        }
      ],
      message: "Aavegotchi GLB zatím není v datově úsporném modelovém balíčku této verze."
    };
  }
};

function isSelection(value: unknown): value is AvatarInventorySelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AvatarInventorySelection>;
  return (
    typeof candidate.inventoryItemId === "string" &&
    candidate.inventoryItemId.length > 0 &&
    candidate.inventoryItemId.length <= 120 &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.length > 0 &&
    candidate.displayName.length <= 160 &&
    (candidate.source === "neutral-placeholder" ||
      candidate.source === "fixture" ||
      candidate.source === "verified-inventory") &&
    (candidate.assetId === undefined ||
      (typeof candidate.assetId === "string" && candidate.assetId.length <= 120)) &&
    (candidate.tokenReference === undefined ||
      (typeof candidate.tokenReference === "string" && candidate.tokenReference.length <= 120))
  );
}

export function loadAvatarInventorySelection(): AvatarInventorySelection {
  if (typeof window === "undefined") return NEUTRAL_AVATAR_SELECTION;
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return NEUTRAL_AVATAR_SELECTION;
    const parsed: unknown = JSON.parse(raw);
    return isSelection(parsed) ? parsed : NEUTRAL_AVATAR_SELECTION;
  } catch {
    return NEUTRAL_AVATAR_SELECTION;
  }
}

export function persistAvatarInventorySelection(selection: AvatarInventorySelection): void {
  if (typeof window === "undefined" || !isSelection(selection)) return;
  window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

/** Compatibility mapper for the old style/token event. A token is reference metadata only. */
export function legacyAvatarSelection(
  style: "cube" | "aavegotchi",
  tokenId?: string
): AvatarInventorySelection {
  if (style === "cube") {
    return {
      inventoryItemId: "legacy-generic-player",
      displayName: "Původní 3D postava",
      source: "fixture",
      assetId: "legacy-generic-player"
    };
  }
  const persisted = loadAvatarInventorySelection();
  const tokenReference = /^\d+$/.test(tokenId?.trim() ?? "") ? tokenId!.trim() : undefined;
  return tokenReference ? { ...persisted, tokenReference } : persisted;
}
