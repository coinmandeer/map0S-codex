import {
  MAPOS_V2_SCHEMA_VERSION,
  normalizeSavedPlaceLimit,
  type SavedPlaceCollectionV2,
  type SavedPlaceCollectionVisibilityV2,
  type SavedPlaceListV2,
  type SavedPlaceSnapshotV2,
  type SavedPlaceTargetV2,
  type SavedPlaceV2
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";

const MAX_NOTE_LENGTH = 4_000;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 40;
const MAX_SOURCE_REFS = 12;
const MAX_SORT_ORDER = 1_000_000_000;
const SNAPSHOT_KEYS = new Set([
  "title",
  "position",
  "category",
  "description",
  "sourceRefs",
  "attribution",
  "capturedAt"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, label: string, max: number, nullable = false): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== "string") throw new ClientError(`${label} není platný text`);
  const clean = value.trim();
  if (!clean && nullable) return null;
  if (!clean || clean.length > max) {
    throw new ClientError(`${label} musí mít 1–${max} znaků`);
  }
  return clean;
}

function cleanNullableText(value: unknown, label: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ClientError(`${label} není platný text`);
  const clean = value.trim();
  if (clean.length > max) throw new ClientError(`${label} může mít nejvýše ${max} znaků`);
  return clean || null;
}

function cleanId(value: unknown, label: string, max = 128): string {
  return cleanString(value, label, max) as string;
}

function cleanTarget(value: unknown): SavedPlaceTargetV2 {
  if (!record(value) || typeof value.type !== "string") {
    throw new ClientError("Uložené místo potřebuje právě jeden typ cíle");
  }
  const keys = Object.keys(value).sort();
  if (value.type === "canonical-place" && keys.join(",") === "canonicalPlaceId,type") {
    return { type: value.type, canonicalPlaceId: cleanId(value.canonicalPlaceId, "Canonical ID") };
  }
  if (value.type === "user-pin" && keys.join(",") === "type,userPinId") {
    return { type: value.type, userPinId: cleanId(value.userPinId, "ID pinu") };
  }
  if (value.type === "external-feature" && keys.join(",") === "externalFeatureRef,type") {
    return {
      type: value.type,
      externalFeatureRef: cleanId(value.externalFeatureRef, "Externí reference", 320)
    };
  }
  if (value.type === "embedded-snapshot" && keys.join(",") === "type") {
    return { type: value.type };
  }
  throw new ClientError("Uložené místo musí mít právě jeden platný typ cíle");
}

function cleanSnapshot(value: unknown, now: () => Date): SavedPlaceSnapshotV2 {
  if (!record(value)) throw new ClientError("Chybí omezený snapshot místa");
  if (Object.keys(value).some((key) => !SNAPSHOT_KEYS.has(key))) {
    throw new ClientError("Snapshot obsahuje nepovolená data");
  }
  const title = cleanString(value.title, "Název snapshotu", 180) as string;
  if (!Array.isArray(value.position) || value.position.length !== 2) {
    throw new ClientError("Snapshot potřebuje bod [lng, lat]");
  }
  const [lng, lat] = value.position.map(Number);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng! < -180 ||
    lng! > 180 ||
    lat! < -90 ||
    lat! > 90
  ) {
    throw new ClientError("Snapshot obsahuje neplatné souřadnice");
  }
  const rawRefs = value.sourceRefs ?? [];
  if (!Array.isArray(rawRefs) || rawRefs.length > MAX_SOURCE_REFS) {
    throw new ClientError(`Snapshot může mít nejvýše ${MAX_SOURCE_REFS} zdrojových referencí`);
  }
  const sourceRefs = rawRefs.map((raw) => {
    if (!record(raw) || Object.keys(raw).some((key) => key !== "source" && key !== "sourceRef")) {
      throw new ClientError("Neplatná zdrojová reference snapshotu");
    }
    return {
      source: cleanString(raw.source, "Zdroj", 40) as string,
      sourceRef: cleanString(raw.sourceRef, "Reference zdroje", 220) as string
    };
  });
  const capturedAt = value.capturedAt == null ? now().toISOString() : String(value.capturedAt);
  if (Number.isNaN(Date.parse(capturedAt)))
    throw new ClientError("capturedAt musí být datum a čas");

  return {
    title,
    position: [lng!, lat!],
    category: cleanNullableText(value.category, "Kategorie snapshotu", 80),
    description: cleanNullableText(value.description, "Popis snapshotu", 2_000),
    sourceRefs,
    attribution: cleanNullableText(value.attribution, "Atribuce", 500),
    capturedAt: new Date(capturedAt).toISOString()
  };
}

function cleanTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    throw new ClientError(`Uložené místo může mít nejvýše ${MAX_TAGS} tagů`);
  }
  const tags: string[] = [];
  for (const raw of value) {
    const tag = cleanString(raw, "Tag", MAX_TAG_LENGTH) as string;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function cleanSortOrder(value: unknown): number {
  const parsed = value == null ? 0 : Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > MAX_SORT_ORDER) {
    throw new ClientError("Neplatné pořadí uloženého místa");
  }
  return parsed;
}

export interface StoredSavedPlace {
  id: string;
  userId: string;
  target: SavedPlaceTargetV2;
  snapshot: SavedPlaceSnapshotV2;
  category: string;
  note: string | null;
  tags: string[];
  collectionId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredSavedPlaceCollection {
  id: string;
  userId: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: SavedPlaceCollectionVisibilityV2;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedPlaceCursor {
  version: 1;
  sortOrder: number;
  createdAt: Date;
  id: string;
}

export interface SavedPlaceRepositoryListQuery {
  limit: number;
  cursor: SavedPlaceCursor | null;
  search: string | null;
  category: string | null;
  collectionId: string | null;
}

export interface SavedPlaceRepository {
  isTargetAccessible(userId: string, target: SavedPlaceTargetV2): Promise<boolean>;
  list(
    userId: string,
    query: SavedPlaceRepositoryListQuery
  ): Promise<{ rows: StoredSavedPlace[]; hasMore: boolean }>;
  find(userId: string, id: string): Promise<StoredSavedPlace | null>;
  create(
    userId: string,
    input: Omit<StoredSavedPlace, "id" | "userId" | "createdAt" | "updatedAt">
  ): Promise<StoredSavedPlace>;
  update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<
        StoredSavedPlace,
        "snapshot" | "category" | "note" | "tags" | "collectionId" | "sortOrder"
      >
    >
  ): Promise<StoredSavedPlace | null>;
  delete(userId: string, id: string): Promise<boolean>;

  listCollections(userId: string): Promise<StoredSavedPlaceCollection[]>;
  findCollection(userId: string, id: string): Promise<StoredSavedPlaceCollection | null>;
  createCollection(
    userId: string,
    input: Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">
  ): Promise<StoredSavedPlaceCollection>;
  updateCollection(
    userId: string,
    id: string,
    patch: Partial<Pick<StoredSavedPlaceCollection, "name" | "icon" | "color" | "visibility">>
  ): Promise<StoredSavedPlaceCollection | null>;
  /** Deleting a collection keeps its saves and moves them back to the uncollected root. */
  deleteCollection(userId: string, id: string): Promise<boolean>;
}

export interface CreateSavedPlaceInput {
  target: SavedPlaceTargetV2;
  snapshot: SavedPlaceSnapshotV2;
  category?: string;
  note?: string | null;
  tags?: string[];
  collectionId?: string | null;
  sortOrder?: number;
}

export interface UpdateSavedPlaceInput {
  snapshot?: SavedPlaceSnapshotV2;
  category?: string;
  note?: string | null;
  tags?: string[];
  collectionId?: string | null;
  sortOrder?: number;
}

export interface SavedPlaceListInput {
  cursor?: string;
  q?: string;
  category?: string;
  collection?: string;
  limit?: number | string;
}

function publicSavedPlace(row: StoredSavedPlace): SavedPlaceV2 {
  return {
    schema: "mapos.saved-place",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: row.id,
    ownerUserId: row.userId,
    target: row.target,
    snapshot: row.snapshot,
    category: row.category,
    note: row.note,
    tags: row.tags,
    collectionId: row.collectionId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function publicCollection(row: StoredSavedPlaceCollection): SavedPlaceCollectionV2 {
  return {
    schema: "mapos.saved-place-collection",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: row.id,
    ownerUserId: row.userId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function encodeCursor(row: StoredSavedPlace): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      s: row.sortOrder,
      t: row.createdAt.toISOString(),
      i: row.id
    })
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): SavedPlaceCursor | null {
  if (!value) return null;
  if (value.length > 512) throw new ClientError("Neplatný cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!record(parsed) || parsed.v !== 1 || typeof parsed.i !== "string") {
      throw new Error("shape");
    }
    const sortOrder = cleanSortOrder(parsed.s);
    const createdAt = new Date(String(parsed.t));
    if (Number.isNaN(createdAt.getTime()) || !parsed.i || parsed.i.length > 128) {
      throw new Error("fields");
    }
    return { version: 1, sortOrder, createdAt, id: parsed.i };
  } catch {
    throw new ClientError("Neplatný cursor");
  }
}

function cleanVisibility(value: unknown): SavedPlaceCollectionVisibilityV2 {
  const visibility = value ?? "private";
  if (visibility !== "private" && visibility !== "unlisted" && visibility !== "public") {
    throw new ClientError("Neplatná viditelnost kolekce");
  }
  return visibility;
}

function cleanColor(value: unknown): string | null {
  if (value == null || value === "") return null;
  const color = cleanString(value, "Barva", 7) as string;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ClientError("Barva musí mít tvar #RRGGBB");
  return color.toLowerCase();
}

export class SavedPlaceService {
  constructor(
    private readonly repository: SavedPlaceRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async assertCollectionNameAvailable(
    userId: string,
    name: string,
    exceptId: string | null = null
  ): Promise<void> {
    const duplicate = (await this.repository.listCollections(userId)).some(
      (collection) => collection.id !== exceptId && collection.name === name
    );
    if (duplicate) throw new ClientError("Kolekce s tímto názvem už existuje", 409);
  }

  async list(userId: string, input: SavedPlaceListInput): Promise<SavedPlaceListV2> {
    const search = input.q == null ? null : cleanNullableText(input.q, "Hledání", 120);
    const category =
      input.category == null ? null : cleanNullableText(input.category, "Kategorie", 80);
    const collectionId =
      input.collection == null ? null : cleanNullableText(input.collection, "Kolekce", 128);
    const limit = normalizeSavedPlaceLimit(input.limit, 20);
    const result = await this.repository.list(userId, {
      limit,
      cursor: decodeCursor(input.cursor),
      search,
      category,
      collectionId
    });
    return {
      savedPlaces: result.rows.map(publicSavedPlace),
      nextCursor: result.hasMore && result.rows.length ? encodeCursor(result.rows.at(-1)!) : null,
      limit
    };
  }

  async get(userId: string, id: string): Promise<SavedPlaceV2> {
    const row = await this.repository.find(userId, cleanId(id, "ID uloženého místa"));
    if (!row) throw new ClientError("Uložené místo nebylo nalezeno", 404);
    return publicSavedPlace(row);
  }

  async create(userId: string, raw: CreateSavedPlaceInput): Promise<SavedPlaceV2> {
    const target = cleanTarget(raw.target);
    const snapshot = cleanSnapshot(raw.snapshot, this.now);
    if (!(await this.repository.isTargetAccessible(userId, target))) {
      throw new ClientError("Cílové místo nebylo nalezeno", 404);
    }
    const collectionId = raw.collectionId == null ? null : cleanId(raw.collectionId, "ID kolekce");
    if (collectionId && !(await this.repository.findCollection(userId, collectionId))) {
      throw new ClientError("Kolekce nebyla nalezena", 404);
    }
    const category = cleanString(
      raw.category ?? snapshot.category ?? "place",
      "Kategorie",
      80
    ) as string;
    const row = await this.repository.create(userId, {
      target,
      snapshot,
      category,
      note: cleanNullableText(raw.note, "Poznámka", MAX_NOTE_LENGTH),
      tags: cleanTags(raw.tags),
      collectionId,
      sortOrder: cleanSortOrder(raw.sortOrder)
    });
    return publicSavedPlace(row);
  }

  async update(userId: string, id: string, raw: UpdateSavedPlaceInput): Promise<SavedPlaceV2> {
    const patch: Parameters<SavedPlaceRepository["update"]>[2] = {};
    if (raw.snapshot !== undefined) patch.snapshot = cleanSnapshot(raw.snapshot, this.now);
    if (raw.category !== undefined)
      patch.category = cleanString(raw.category, "Kategorie", 80) as string;
    if (raw.note !== undefined)
      patch.note = cleanNullableText(raw.note, "Poznámka", MAX_NOTE_LENGTH);
    if (raw.tags !== undefined) patch.tags = cleanTags(raw.tags);
    if (raw.sortOrder !== undefined) patch.sortOrder = cleanSortOrder(raw.sortOrder);
    if (raw.collectionId !== undefined) {
      const collectionId =
        raw.collectionId == null ? null : cleanId(raw.collectionId, "ID kolekce");
      if (collectionId && !(await this.repository.findCollection(userId, collectionId))) {
        throw new ClientError("Kolekce nebyla nalezena", 404);
      }
      patch.collectionId = collectionId;
    }
    if (!Object.keys(patch).length) throw new ClientError("Chybí změna uloženého místa");
    const row = await this.repository.update(userId, cleanId(id, "ID uloženého místa"), patch);
    if (!row) throw new ClientError("Uložené místo nebylo nalezeno", 404);
    return publicSavedPlace(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    if (!(await this.repository.delete(userId, cleanId(id, "ID uloženého místa")))) {
      throw new ClientError("Uložené místo nebylo nalezeno", 404);
    }
  }

  async listCollections(userId: string): Promise<SavedPlaceCollectionV2[]> {
    return (await this.repository.listCollections(userId)).map(publicCollection);
  }

  async getCollection(userId: string, id: string): Promise<SavedPlaceCollectionV2> {
    const row = await this.repository.findCollection(userId, cleanId(id, "ID kolekce"));
    if (!row) throw new ClientError("Kolekce nebyla nalezena", 404);
    return publicCollection(row);
  }

  async createCollection(
    userId: string,
    raw: { name: string; icon?: string | null; color?: string | null; visibility?: string }
  ): Promise<SavedPlaceCollectionV2> {
    const name = cleanString(raw.name, "Název kolekce", 120) as string;
    await this.assertCollectionNameAvailable(userId, name);
    const row = await this.repository.createCollection(userId, {
      name,
      icon: cleanNullableText(raw.icon, "Ikona", 80),
      color: cleanColor(raw.color),
      visibility: cleanVisibility(raw.visibility)
    });
    return publicCollection(row);
  }

  async updateCollection(
    userId: string,
    id: string,
    raw: { name?: string; icon?: string | null; color?: string | null; visibility?: string }
  ): Promise<SavedPlaceCollectionV2> {
    const collectionId = cleanId(id, "ID kolekce");
    if (!(await this.repository.findCollection(userId, collectionId))) {
      throw new ClientError("Kolekce nebyla nalezena", 404);
    }
    const patch: Parameters<SavedPlaceRepository["updateCollection"]>[2] = {};
    if (raw.name !== undefined) {
      patch.name = cleanString(raw.name, "Název kolekce", 120) as string;
      await this.assertCollectionNameAvailable(userId, patch.name, collectionId);
    }
    if (raw.icon !== undefined) patch.icon = cleanNullableText(raw.icon, "Ikona", 80);
    if (raw.color !== undefined) patch.color = cleanColor(raw.color);
    if (raw.visibility !== undefined) patch.visibility = cleanVisibility(raw.visibility);
    if (!Object.keys(patch).length) throw new ClientError("Chybí změna kolekce");
    const row = await this.repository.updateCollection(userId, collectionId, patch);
    if (!row) throw new ClientError("Kolekce nebyla nalezena", 404);
    return publicCollection(row);
  }

  async deleteCollection(userId: string, id: string): Promise<void> {
    if (!(await this.repository.deleteCollection(userId, cleanId(id, "ID kolekce")))) {
      throw new ClientError("Kolekce nebyla nalezena", 404);
    }
  }
}

export const __testing = { cleanSnapshot, cleanTarget, decodeCursor };
