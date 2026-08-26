import { nanoid } from "nanoid";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Bbox } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { osmPois, userLayers, userPins } from "../db/schema.js";
import { reverseGeocodeCountry } from "./discoverService.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || nanoid(8)
  );
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
  let slug = slugify(name);
  const existing = await db.select().from(userLayers).where(eq(userLayers.slug, slug)).limit(1);
  if (existing.length) slug = `${slug}-${nanoid(4)}`;
  const [layer] = await db.insert(userLayers).values({ userId, name, color, slug }).returning();
  return { ...layer!, pinCount: 0 };
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
  const [layer] = await db.select().from(userLayers).where(eq(userLayers.id, layerId)).limit(1);
  if (!layer || layer.userId !== userId) throw new Error("Layer not found");
  const country = await reverseGeocodeCountry(lng, lat);
  const normalizedTags = (tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  const [pin] = await db
    .insert(userPins)
    .values({
      layerId,
      name,
      lng,
      lat,
      description,
      tags: normalizedTags,
      kind: kind ?? "place",
      country,
      authorName: authorName ?? null,
      properties: properties ?? {}
    })
    .returning();
  return pin!;
}

export async function getLayerBySlug(slug: string) {
  const [layer] = await db.select().from(userLayers).where(eq(userLayers.slug, slug)).limit(1);
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
      return { ...p, layerName: layer?.name ?? "", layerColor: layer?.color ?? "#10b981" };
    });
}

export async function getTopOsmForCountry(
  bbox: Bbox,
  categories = ["castle", "viewpoint", "museum"]
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
    .limit(30);
  return rows
    .filter((r) => r.name)
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      lng: r.lng,
      lat: r.lat
    }));
}
