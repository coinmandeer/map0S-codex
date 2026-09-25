import { nanoid } from "nanoid";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Bbox, LayerManifestV2 } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { osmPois, userLayers, userPins } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import { reverseGeocodeCountry } from "./discoverService.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || nanoid(8)
  );
}

function cleanName(value: string, label: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new ClientError(`${label} musí mít 1–120 znaků`);
  return name;
}

function cleanColor(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new ClientError("Neplatná barva vrstvy");
  return value;
}

function cleanCoordinates(lng: number, lat: number) {
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new ClientError("Neplatné souřadnice");
  }
  return { lng, lat };
}

function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(
    0,
    8
  );
}

function cleanKind(kind: string | undefined): string {
  const value = kind ?? "place";
  if (!new Set(["place", "route", "task"]).has(value)) throw new ClientError("Neplatný druh pinu");
  return value;
}

async function ownedLayer(layerId: string, userId: string) {
  const [layer] = await db.select().from(userLayers).where(eq(userLayers.id, layerId)).limit(1);
  if (!layer || layer.userId !== userId) throw new ClientError("Layer not found", 404);
  return layer;
}

export async function ownedSourceManifest(
  layerId: string,
  userId: string
): Promise<LayerManifestV2 | null> {
  const [layer] = await db
    .select({ manifest: userLayers.sourceManifest })
    .from(userLayers)
    .where(and(eq(userLayers.id, layerId), eq(userLayers.userId, userId)))
    .limit(1);
  return layer?.manifest ?? null;
}

export async function listUserLayers(userId: string) {
  const layers = await db.select().from(userLayers).where(eq(userLayers.userId, userId));
  const result = [];
  for (const layer of layers) {
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userPins)
      .where(eq(userPins.layerId, layer.id));
    result.push({ ...layer, pinCount: count?.count ?? 0 });
  }
  return result;
}

export async function createUserLayer(userId: string, name: string, color: string) {
  const clean = cleanName(name, "Název vrstvy");
  const cleanLayerColor = cleanColor(color);
  let slug = slugify(clean);
  const existing = await db.select().from(userLayers).where(eq(userLayers.slug, slug)).limit(1);
  if (existing.length) slug = `${slug}-${nanoid(4)}`;
  const [layer] = await db
    .insert(userLayers)
    .values({ userId, name: clean, color: cleanLayerColor, slug })
    .returning();
  return { ...layer!, pinCount: 0 };
}

/**
 * A layer that is a remote source rather than a set of pins.
 *
 * Kept beside `createUserLayer` rather than folded into it because the two have nothing in
 * common past the name and the colour: this one has a manifest and no rows, and there is no
 * point at which a caller would want either shape interchangeably.
 */
export async function createSourceLayer(
  userId: string,
  input: {
    name: string;
    color?: string;
    sourceUrl: string;
    sourceManifest: LayerManifestV2;
    sourceAdapterId: string;
    isPublic?: boolean;
  }
) {
  const clean = cleanName(input.name, "Název vrstvy");
  let slug = slugify(clean);
  const existing = await db.select().from(userLayers).where(eq(userLayers.slug, slug)).limit(1);
  if (existing.length) slug = `${slug}-${nanoid(4)}`;
  const [layer] = await db
    .insert(userLayers)
    .values({
      userId,
      name: clean,
      color: cleanColor(input.color ?? "#0ea5e9"),
      slug,
      isPublic: input.isPublic ? 1 : 0,
      sourceUrl: input.sourceUrl,
      sourceManifest: input.sourceManifest,
      sourceAdapterId: input.sourceAdapterId
    })
    .returning();
  return { ...layer!, pinCount: 0 };
}

export async function updateUserLayer(
  layerId: string,
  userId: string,
  patch: { name?: string; color?: string; isPublic?: boolean }
) {
  const current = await ownedLayer(layerId, userId);
  const values: Partial<typeof userLayers.$inferInsert> = {};
  if (patch.name !== undefined) values.name = cleanName(patch.name, "Název vrstvy");
  if (patch.color !== undefined) values.color = cleanColor(patch.color);
  if (patch.isPublic !== undefined) values.isPublic = patch.isPublic ? 1 : 0;
  const [updated] = Object.keys(values).length
    ? await db.update(userLayers).set(values).where(eq(userLayers.id, layerId)).returning()
    : [current];
  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userPins)
    .where(eq(userPins.layerId, layerId));
  return { ...updated!, pinCount: count?.count ?? 0 };
}

export async function deleteUserLayer(layerId: string, userId: string) {
  await ownedLayer(layerId, userId);
  await db.delete(userLayers).where(eq(userLayers.id, layerId));
}

export async function addPin(
  layerId: string,
  userId: string,
  name: string,
  lng: number,
  lat: number,
  description?: string,
  tags?: string[],
  kind?: string,
  authorName?: string,
  properties?: Record<string, unknown>
) {
  await ownedLayer(layerId, userId);
  const clean = cleanName(name, "Název pinu");
  const coords = cleanCoordinates(lng, lat);
  const country = await reverseGeocodeCountry(lng, lat);
  const normalizedTags = cleanTags(tags);
  const [pin] = await db
    .insert(userPins)
    .values({
      layerId,
      name: clean,
      ...coords,
      description: description?.trim().slice(0, 2000),
      tags: normalizedTags,
      kind: cleanKind(kind),
      country,
      authorName: authorName ?? null,
      properties: properties ?? {}
    })
    .returning();
  return pin!;
}

export async function listPinsForOwnedLayer(layerId: string, userId: string) {
  await ownedLayer(layerId, userId);
  return db.select().from(userPins).where(eq(userPins.layerId, layerId));
}

export async function updatePin(
  layerId: string,
  pinId: string,
  userId: string,
  patch: {
    name?: string;
    description?: string;
    lng?: number;
    lat?: number;
    tags?: string[];
    kind?: string;
  }
) {
  await ownedLayer(layerId, userId);
  const [current] = await db
    .select()
    .from(userPins)
    .where(and(eq(userPins.id, pinId), eq(userPins.layerId, layerId)))
    .limit(1);
  if (!current) throw new ClientError("Pin not found", 404);

  const values: Partial<typeof userPins.$inferInsert> = {};
  if (patch.name !== undefined) values.name = cleanName(patch.name, "Název pinu");
  if (patch.description !== undefined) values.description = patch.description.trim().slice(0, 2000);
  if (patch.tags !== undefined) values.tags = cleanTags(patch.tags);
  if (patch.kind !== undefined) values.kind = cleanKind(patch.kind);
  if (patch.lng !== undefined || patch.lat !== undefined) {
    const coords = cleanCoordinates(patch.lng ?? current.lng, patch.lat ?? current.lat);
    values.lng = coords.lng;
    values.lat = coords.lat;
    values.country = await reverseGeocodeCountry(coords.lng, coords.lat);
  }
  const [updated] = Object.keys(values).length
    ? await db.update(userPins).set(values).where(eq(userPins.id, pinId)).returning()
    : [current];
  return updated!;
}

export async function deletePin(layerId: string, pinId: string, userId: string) {
  await ownedLayer(layerId, userId);
  const deleted = await db
    .delete(userPins)
    .where(and(eq(userPins.id, pinId), eq(userPins.layerId, layerId)))
    .returning({ id: userPins.id });
  if (!deleted.length) throw new ClientError("Pin not found", 404);
}

export async function getPublicLayerBySlug(slug: string) {
  const [layer] = await db
    .select({
      id: userLayers.id,
      name: userLayers.name,
      color: userLayers.color,
      slug: userLayers.slug,
      isPublic: userLayers.isPublic,
      createdAt: userLayers.createdAt
    })
    .from(userLayers)
    .where(and(eq(userLayers.slug, slug), eq(userLayers.isPublic, 1)))
    .limit(1);
  return layer ?? null;
}

export async function getPinsForLayer(layerId: string) {
  return db.select().from(userPins).where(eq(userPins.layerId, layerId));
}

export async function getDiscoverPins(countryCode: string, bbox?: Bbox, tag?: string, limit = 40) {
  const layers = await db.select().from(userLayers).where(eq(userLayers.isPublic, 1));
  const layerIds = layers.map((l) => l.id);
  if (!layerIds.length) return [];

  const rows = await db.select().from(userPins).where(inArray(userPins.layerId, layerIds));
  return rows
    .filter((p) => {
      if (countryCode !== "ALL" && p.country && p.country !== countryCode) return false;
      if (tag && !(p.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      if (bbox) {
        const [w, s, e, n] = bbox;
        if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) return false;
      }
      return true;
    })
    .slice(0, limit)
    .map((p) => {
      const layer = layers.find((l) => l.id === p.layerId);
      return {
        ...p,
        layerName: layer?.name ?? "",
        layerColor: layer?.color ?? "#10b981",
        // A pin has no author column of its own; who published it is a property of the layer it
        // sits in. The feed needs it to answer "from people I follow".
        layerUserId: layer?.userId ?? null
      };
    });
}

export async function getTopOsmForCountry(
  bbox: Bbox,
  categories = ["castle", "viewpoint", "museum", "palace", "ruins", "monument", "waterfall", "cave"]
) {
  const [w, s, e, n] = bbox;
  const rows = await db
    .select()
    .from(osmPois)
    .where(
      and(
        inArray(osmPois.category, categories),
        gte(osmPois.lng, w),
        lte(osmPois.lng, e),
        gte(osmPois.lat, s),
        lte(osmPois.lat, n)
      )
    )
    .limit(60);
  return rows
    .filter((r) => r.name)
    .map((r) => {
      // Mappers record these two tags on exactly the places worth ranking, and they are what
      // lets a POI be looked up in Wikidata and Wikipedia at all.
      const tags = (r.tags ?? {}) as Record<string, string>;
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        lng: r.lng,
        lat: r.lat,
        wikidataId: tags.wikidata,
        // The tag is "cs:Pražský hrad"; the language prefix is not part of the title.
        wikipediaTitle: tags.wikipedia?.includes(":")
          ? tags.wikipedia.slice(tags.wikipedia.indexOf(":") + 1)
          : tags.wikipedia
      };
    });
}
