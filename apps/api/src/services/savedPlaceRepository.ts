import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";
import type { SavedPlaceSnapshotV2, SavedPlaceTargetV2 } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import {
  canonicalPlaces,
  savedPlaceCollections,
  savedPlaces,
  userLayers,
  userPins
} from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import type {
  SavedPlaceRepository,
  SavedPlaceRepositoryListQuery,
  StoredSavedPlace,
  StoredSavedPlaceCollection
} from "./savedPlaceService.js";

type SavedPlaceRow = typeof savedPlaces.$inferSelect;
type CollectionRow = typeof savedPlaceCollections.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rethrowCollectionWrite(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  if (code === "23505") throw new ClientError("Kolekce s tímto názvem už existuje", 409);
  throw error;
}

function targetFromRow(row: SavedPlaceRow): SavedPlaceTargetV2 {
  if (row.canonicalPlaceId) {
    return { type: "canonical-place", canonicalPlaceId: row.canonicalPlaceId };
  }
  if (row.userPinId) return { type: "user-pin", userPinId: row.userPinId };
  if (row.externalFeatureRef) {
    return { type: "external-feature", externalFeatureRef: row.externalFeatureRef };
  }
  if (row.embeddedSnapshot) return { type: "embedded-snapshot" };
  throw new Error(`Saved place ${row.id} violates its target constraint`);
}

function storedPlace(row: SavedPlaceRow): StoredSavedPlace {
  const snapshot = row.embeddedSnapshot ?? row.sourceSnapshot;
  if (!snapshot) throw new Error(`Saved place ${row.id} has no preserved snapshot`);
  return {
    id: row.id,
    userId: row.userId,
    target: targetFromRow(row),
    snapshot,
    category: row.category,
    note: row.note,
    tags: row.tags,
    collectionId: row.collectionId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function storedCollection(row: CollectionRow): StoredSavedPlaceCollection {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    visibility: row.visibility as StoredSavedPlaceCollection["visibility"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function targetColumns(target: SavedPlaceTargetV2, snapshot: SavedPlaceSnapshotV2) {
  return {
    canonicalPlaceId: target.type === "canonical-place" ? target.canonicalPlaceId : null,
    userPinId: target.type === "user-pin" ? target.userPinId : null,
    externalFeatureRef: target.type === "external-feature" ? target.externalFeatureRef : null,
    embeddedSnapshot: target.type === "embedded-snapshot" ? snapshot : null,
    sourceSnapshot: target.type === "embedded-snapshot" ? null : snapshot
  };
}

/** PostgreSQL implementation; every query carries userId so an ID alone is never an ACL. */
export class PostgresSavedPlaceRepository implements SavedPlaceRepository {
  async isTargetAccessible(userId: string, target: SavedPlaceTargetV2): Promise<boolean> {
    if (target.type === "embedded-snapshot" || target.type === "external-feature") return true;
    if (target.type === "canonical-place") {
      if (!UUID.test(target.canonicalPlaceId)) return false;
      const rows = await db
        .select({ id: canonicalPlaces.id })
        .from(canonicalPlaces)
        .where(eq(canonicalPlaces.id, target.canonicalPlaceId))
        .limit(1);
      return rows.length === 1;
    }
    if (!UUID.test(target.userPinId)) return false;
    const rows = await db
      .select({ id: userPins.id })
      .from(userPins)
      .innerJoin(userLayers, eq(userPins.layerId, userLayers.id))
      .where(
        and(
          eq(userPins.id, target.userPinId),
          or(eq(userLayers.userId, userId), eq(userLayers.isPublic, 1))
        )
      )
      .limit(1);
    return rows.length === 1;
  }

  async list(userId: string, query: SavedPlaceRepositoryListQuery) {
    const conditions: SQL[] = [eq(savedPlaces.userId, userId)];
    if (query.category) conditions.push(eq(savedPlaces.category, query.category));
    if (query.collectionId) conditions.push(eq(savedPlaces.collectionId, query.collectionId));
    if (query.search) {
      conditions.push(
        or(
          sql`strpos(lower(COALESCE(${savedPlaces.note}, '')), lower(${query.search})) > 0`,
          sql`strpos(
            lower(COALESCE(${savedPlaces.sourceSnapshot}->>'title', ${savedPlaces.embeddedSnapshot}->>'title', '')),
            lower(${query.search})
          ) > 0`,
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(${savedPlaces.tags}) AS saved_tag(value)
            WHERE strpos(lower(saved_tag.value), lower(${query.search})) > 0
          )`
        )!
      );
    }
    if (query.cursor) {
      conditions.push(
        or(
          gt(savedPlaces.sortOrder, query.cursor.sortOrder),
          and(
            eq(savedPlaces.sortOrder, query.cursor.sortOrder),
            lt(savedPlaces.createdAt, query.cursor.createdAt)
          ),
          and(
            eq(savedPlaces.sortOrder, query.cursor.sortOrder),
            eq(savedPlaces.createdAt, query.cursor.createdAt),
            lt(savedPlaces.id, query.cursor.id)
          )
        )!
      );
    }
    const rows = await db
      .select()
      .from(savedPlaces)
      .where(and(...conditions))
      .orderBy(asc(savedPlaces.sortOrder), desc(savedPlaces.createdAt), desc(savedPlaces.id))
      .limit(query.limit + 1);
    return {
      rows: rows.slice(0, query.limit).map(storedPlace),
      hasMore: rows.length > query.limit
    };
  }

  async find(userId: string, id: string): Promise<StoredSavedPlace | null> {
    if (!UUID.test(id)) return null;
    const [row] = await db
      .select()
      .from(savedPlaces)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
      .limit(1);
    return row ? storedPlace(row) : null;
  }

  async create(
    userId: string,
    input: Omit<StoredSavedPlace, "id" | "userId" | "createdAt" | "updatedAt">
  ): Promise<StoredSavedPlace> {
    const [row] = await db
      .insert(savedPlaces)
      .values({
        userId,
        ...targetColumns(input.target, input.snapshot),
        category: input.category,
        note: input.note,
        tags: input.tags,
        collectionId: input.collectionId,
        sortOrder: input.sortOrder
      })
      .returning();
    if (!row) throw new Error("Saved place was not created");
    return storedPlace(row);
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
    if (!UUID.test(id)) return null;
    const current = await this.find(userId, id);
    if (!current) return null;
    const values: Partial<typeof savedPlaces.$inferInsert> = { updatedAt: new Date() };
    if (patch.snapshot !== undefined) {
      if (current.target.type === "embedded-snapshot") values.embeddedSnapshot = patch.snapshot;
      else values.sourceSnapshot = patch.snapshot;
    }
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.note !== undefined) values.note = patch.note;
    if (patch.tags !== undefined) values.tags = patch.tags;
    if (patch.collectionId !== undefined) values.collectionId = patch.collectionId;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    const [row] = await db
      .update(savedPlaces)
      .set(values)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
      .returning();
    return row ? storedPlace(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await db
      .delete(savedPlaces)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
      .returning({ id: savedPlaces.id });
    return rows.length === 1;
  }

  async listCollections(userId: string): Promise<StoredSavedPlaceCollection[]> {
    const rows = await db
      .select()
      .from(savedPlaceCollections)
      .where(eq(savedPlaceCollections.userId, userId))
      .orderBy(asc(savedPlaceCollections.name), asc(savedPlaceCollections.id));
    return rows.map(storedCollection);
  }

  async findCollection(userId: string, id: string): Promise<StoredSavedPlaceCollection | null> {
    if (!UUID.test(id)) return null;
    const [row] = await db
      .select()
      .from(savedPlaceCollections)
      .where(and(eq(savedPlaceCollections.id, id), eq(savedPlaceCollections.userId, userId)))
      .limit(1);
    return row ? storedCollection(row) : null;
  }

  async createCollection(
    userId: string,
    input: Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">
  ): Promise<StoredSavedPlaceCollection> {
    try {
      const [row] = await db
        .insert(savedPlaceCollections)
        .values({ userId, ...input })
        .returning();
      if (!row) throw new Error("Saved-place collection was not created");
      return storedCollection(row);
    } catch (error) {
      rethrowCollectionWrite(error);
    }
  }

  async updateCollection(
    userId: string,
    id: string,
    patch: Partial<Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">>
  ): Promise<StoredSavedPlaceCollection | null> {
    if (!UUID.test(id)) return null;
    try {
      const [row] = await db
        .update(savedPlaceCollections)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(savedPlaceCollections.id, id), eq(savedPlaceCollections.userId, userId)))
        .returning();
      return row ? storedCollection(row) : null;
    } catch (error) {
      rethrowCollectionWrite(error);
    }
  }

  async deleteCollection(userId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: savedPlaceCollections.id })
        .from(savedPlaceCollections)
        .where(and(eq(savedPlaceCollections.id, id), eq(savedPlaceCollections.userId, userId)))
        .limit(1);
      if (!owned) return false;
      await tx
        .update(savedPlaces)
        .set({ collectionId: null, updatedAt: new Date() })
        .where(and(eq(savedPlaces.userId, userId), eq(savedPlaces.collectionId, id)));
      await tx
        .delete(savedPlaceCollections)
        .where(and(eq(savedPlaceCollections.id, id), eq(savedPlaceCollections.userId, userId)));
      return true;
    });
  }
}

export const postgresSavedPlaceRepository = new PostgresSavedPlaceRepository();

export const __testing = { storedPlace, targetColumns };
