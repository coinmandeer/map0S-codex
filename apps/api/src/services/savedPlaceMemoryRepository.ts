import { nanoid } from "nanoid";
import type { SavedPlaceTargetV2 } from "@mapos/layer-sdk";
import { memoryDb } from "../db/memory.js";
import type {
  SavedPlaceRepository,
  SavedPlaceRepositoryListQuery,
  StoredSavedPlace,
  StoredSavedPlaceCollection
} from "./savedPlaceService.js";

function clonePlace(row: StoredSavedPlace): StoredSavedPlace {
  return {
    ...row,
    target: { ...row.target },
    snapshot: {
      ...row.snapshot,
      position: [...row.snapshot.position],
      sourceRefs: row.snapshot.sourceRefs.map((source) => ({ ...source }))
    },
    tags: [...row.tags],
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  } as StoredSavedPlace;
}

function cloneCollection(row: StoredSavedPlaceCollection): StoredSavedPlaceCollection {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function afterCursor(row: StoredSavedPlace, query: SavedPlaceRepositoryListQuery): boolean {
  const cursor = query.cursor;
  if (!cursor) return true;
  if (row.sortOrder !== cursor.sortOrder) return row.sortOrder > cursor.sortOrder;
  const rowTime = row.createdAt.getTime();
  const cursorTime = cursor.createdAt.getTime();
  if (rowTime !== cursorTime) return rowTime < cursorTime;
  return row.id < cursor.id;
}

/** Deterministic process-local adapter used by the memory/offline server and contract tests. */
export class MemorySavedPlaceRepository implements SavedPlaceRepository {
  async isTargetAccessible(userId: string, target: SavedPlaceTargetV2): Promise<boolean> {
    if (target.type === "embedded-snapshot" || target.type === "external-feature") return true;
    if (target.type === "canonical-place") {
      return memoryDb.canonicalPlaceIds.has(target.canonicalPlaceId);
    }
    const pin = memoryDb.pins.find((candidate) => candidate.id === target.userPinId);
    if (!pin) return false;
    const layer = memoryDb.userLayers.find((candidate) => candidate.id === pin.layerId);
    return Boolean(layer && (layer.userId === userId || layer.isPublic === 1));
  }

  async list(userId: string, query: SavedPlaceRepositoryListQuery) {
    const search = query.search?.toLocaleLowerCase("cs") ?? null;
    const rows = memoryDb.savedPlaces
      .filter((row) => row.userId === userId)
      .filter((row) => !query.category || row.category === query.category)
      .filter((row) => !query.collectionId || row.collectionId === query.collectionId)
      .filter(
        (row) =>
          !search ||
          row.snapshot.title.toLocaleLowerCase("cs").includes(search) ||
          row.note?.toLocaleLowerCase("cs").includes(search) ||
          row.tags.some((tag) => tag.toLocaleLowerCase("cs").includes(search))
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id)
      )
      .filter((row) => afterCursor(row, query));
    return {
      rows: rows.slice(0, query.limit).map(clonePlace),
      hasMore: rows.length > query.limit
    };
  }

  async find(userId: string, id: string): Promise<StoredSavedPlace | null> {
    const row = memoryDb.savedPlaces.find(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    return row ? clonePlace(row) : null;
  }

  async create(
    userId: string,
    input: Omit<StoredSavedPlace, "id" | "userId" | "createdAt" | "updatedAt">
  ): Promise<StoredSavedPlace> {
    const now = new Date();
    const row: StoredSavedPlace = {
      ...input,
      id: nanoid(),
      userId,
      createdAt: now,
      updatedAt: now
    };
    memoryDb.savedPlaces.push(clonePlace(row));
    return clonePlace(row);
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<
        StoredSavedPlace,
        "snapshot" | "category" | "note" | "tags" | "collectionId" | "sortOrder"
      >
    >
  ): Promise<StoredSavedPlace | null> {
    const row = memoryDb.savedPlaces.find(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    if (!row) return null;
    if (patch.snapshot !== undefined)
      row.snapshot = clonePlace({ ...row, snapshot: patch.snapshot }).snapshot;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.tags !== undefined) row.tags = [...patch.tags];
    if (patch.collectionId !== undefined) row.collectionId = patch.collectionId;
    if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
    row.updatedAt = new Date();
    return clonePlace(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = memoryDb.savedPlaces.findIndex(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    if (index < 0) return false;
    memoryDb.savedPlaces.splice(index, 1);
    return true;
  }

  async listCollections(userId: string): Promise<StoredSavedPlaceCollection[]> {
    return memoryDb.savedPlaceCollections
      .filter((row) => row.userId === userId)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, "cs") || left.id.localeCompare(right.id)
      )
      .map(cloneCollection);
  }

  async findCollection(userId: string, id: string): Promise<StoredSavedPlaceCollection | null> {
    const row = memoryDb.savedPlaceCollections.find(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    return row ? cloneCollection(row) : null;
  }

  async createCollection(
    userId: string,
    input: Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">
  ): Promise<StoredSavedPlaceCollection> {
    const now = new Date();
    const row: StoredSavedPlaceCollection = {
      ...input,
      id: nanoid(),
      userId,
      createdAt: now,
      updatedAt: now
    };
    memoryDb.savedPlaceCollections.push(cloneCollection(row));
    return cloneCollection(row);
  }

  async updateCollection(
    userId: string,
    id: string,
    patch: Partial<Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">>
  ): Promise<StoredSavedPlaceCollection | null> {
    const row = memoryDb.savedPlaceCollections.find(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return cloneCollection(row);
  }

  async deleteCollection(userId: string, id: string): Promise<boolean> {
    const index = memoryDb.savedPlaceCollections.findIndex(
      (candidate) => candidate.id === id && candidate.userId === userId
    );
    if (index < 0) return false;
    memoryDb.savedPlaceCollections.splice(index, 1);
    const now = new Date();
    for (const place of memoryDb.savedPlaces) {
      if (place.userId === userId && place.collectionId === id) {
        place.collectionId = null;
        place.updatedAt = now;
      }
    }
    return true;
  }
}

export const memorySavedPlaceRepository = new MemorySavedPlaceRepository();
