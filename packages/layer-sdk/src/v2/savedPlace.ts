import type { VersionEnvelope } from "./common.js";
import type { Position } from "./feature.js";

export const SAVED_PLACE_QUERY_MAX_LIMIT = 100 as const;

export interface SavedPlaceSourceRefV2 {
  source: string;
  sourceRef: string;
}

/**
 * Small, provider-neutral copy kept with every save.
 *
 * It is deliberately not an arbitrary properties bag: a disappeared provider must not destroy
 * the user's bookmark, while saving a POI must not become an unbounded/licence-blind data dump.
 */
export interface SavedPlaceSnapshotV2 {
  title: string;
  position: Position;
  category?: string | null;
  description?: string | null;
  sourceRefs: SavedPlaceSourceRefV2[];
  attribution?: string | null;
  capturedAt: string;
}

export type SavedPlaceTargetV2 =
  | { type: "canonical-place"; canonicalPlaceId: string }
  | { type: "user-pin"; userPinId: string }
  | { type: "external-feature"; externalFeatureRef: string }
  | { type: "embedded-snapshot" };

export interface SavedPlaceV2 extends VersionEnvelope {
  schema: "mapos.saved-place";
  schemaVersion: string;
  id: string;
  ownerUserId: string;
  target: SavedPlaceTargetV2;
  snapshot: SavedPlaceSnapshotV2;
  category: string;
  note: string | null;
  tags: string[];
  collectionId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type SavedPlaceCollectionVisibilityV2 = "private" | "unlisted" | "public";

export interface SavedPlaceCollectionV2 extends VersionEnvelope {
  schema: "mapos.saved-place-collection";
  schemaVersion: string;
  id: string;
  ownerUserId: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: SavedPlaceCollectionVisibilityV2;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPlaceListV2 {
  savedPlaces: SavedPlaceV2[];
  nextCursor: string | null;
  limit: number;
}

export function normalizeSavedPlaceLimit(value: unknown, fallback = 20): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(SAVED_PLACE_QUERY_MAX_LIMIT, Math.max(1, Math.trunc(fallback)));
  }
  return Math.min(SAVED_PLACE_QUERY_MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}
