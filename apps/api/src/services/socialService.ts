import { and, avg, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Bbox, CanonicalPlace, ContentDraft, SocialTargetType } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import {
  canonicalPlaces,
  contentDrafts,
  placeSources,
  socialComments,
  socialFollows,
  socialReviews,
  users
} from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import { getDiscoverPins } from "./userLayerService.js";
import {
  createDraftPayload,
  reviseDraftPayload,
  submitDraftPayload
} from "./contentDraftWorkflow.js";

const TARGET_TYPES = new Set<SocialTargetType>([
  "user",
  "place",
  "layer",
  "region",
  "route",
  "quest",
  "game"
]);
const REVIEW_TYPES = new Set<SocialTargetType>(["place", "layer", "route", "quest", "game"]);

function cleanTarget(type: unknown, id: unknown, review = false) {
  const targetType = String(type ?? "") as SocialTargetType;
  const targetId = String(id ?? "")
    .trim()
    .slice(0, 220);
  if (!(review ? REVIEW_TYPES : TARGET_TYPES).has(targetType) || !targetId) {
    throw new ClientError("Neplatný sociální cíl");
  }
  return { targetType, targetId };
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function socialCounts(placeId: string) {
  const [[follows], [reviews], [comments]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(socialFollows)
      .where(and(eq(socialFollows.targetType, "place"), eq(socialFollows.targetId, placeId))),
    db
      .select({ count: sql<number>`count(*)::int`, rating: avg(socialReviews.rating) })
      .from(socialReviews)
      .where(and(eq(socialReviews.targetType, "place"), eq(socialReviews.targetId, placeId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(socialComments)
      .where(and(eq(socialComments.targetType, "place"), eq(socialComments.targetId, placeId)))
  ]);
  return {
    followers: follows?.count ?? 0,
    reviews: reviews?.count ?? 0,
    rating: reviews?.rating == null ? null : Number(Number(reviews.rating).toFixed(2)),
    comments: comments?.count ?? 0
  };
}

async function canonicalPlaceResult(placeId: string): Promise<CanonicalPlace> {
  const [place] = await db
    .select()
    .from(canonicalPlaces)
    .where(eq(canonicalPlaces.id, placeId))
    .limit(1);
  if (!place) throw new ClientError("Místo nebylo nalezeno", 404);
  const sources = await db.select().from(placeSources).where(eq(placeSources.placeId, place.id));
  return {
    placeId: place.id,
    name: place.name,
    lng: place.lng,
    lat: place.lat,
    category: place.category,
    sources: sources.map((source) => ({ source: source.source, sourceRef: source.sourceRef })),
    social: await socialCounts(place.id)
  };
}

export async function canonicalizePlace(input: {
  name?: string;
  lng?: number;
  lat?: number;
  category?: string;
  sources?: Array<{ source?: string; sourceRef?: string; payload?: Record<string, unknown> }>;
}) {
  const name = cleanText(input.name, 180);
  const lng = Number(input.lng);
  const lat = Number(input.lat);
  if (
    !name ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 85
  ) {
    throw new ClientError("Místo potřebuje název a platné souřadnice");
  }
  const sourceInputs = (input.sources ?? [])
    .map((source) => ({
      source: cleanText(source.source, 40),
      sourceRef: cleanText(source.sourceRef, 220),
      payload: source.payload ?? {}
    }))
    .filter((source) => source.source && source.sourceRef)
    .slice(0, 12);

  let placeId: string | null = null;
  for (const source of sourceInputs) {
    const [existing] = await db
      .select({ placeId: placeSources.placeId })
      .from(placeSources)
      .where(
        and(eq(placeSources.source, source.source), eq(placeSources.sourceRef, source.sourceRef))
      )
      .limit(1);
    if (existing) {
      placeId = existing.placeId;
      break;
    }
  }
  if (!placeId) {
    const normalized = normalizeName(name);
    const [nearby] = await db
      .select({ id: canonicalPlaces.id })
      .from(canonicalPlaces)
      .where(
        and(
          eq(canonicalPlaces.normalizedName, normalized),
          gte(canonicalPlaces.lng, lng - 0.0005),
          lte(canonicalPlaces.lng, lng + 0.0005),
          gte(canonicalPlaces.lat, lat - 0.0005),
          lte(canonicalPlaces.lat, lat + 0.0005)
        )
      )
      .limit(1);
    if (nearby) placeId = nearby.id;
    else {
      const [created] = await db
        .insert(canonicalPlaces)
        .values({
          name,
          normalizedName: normalized,
          lng,
          lat,
          category: cleanText(input.category, 80) || null
        })
        .returning({ id: canonicalPlaces.id });
      placeId = created!.id;
    }
  }
  for (const source of sourceInputs) {
    await db
      .insert(placeSources)
      .values({ placeId, ...source })
      .onConflictDoNothing({ target: [placeSources.source, placeSources.sourceRef] });
  }
  return canonicalPlaceResult(placeId);
}

export async function listFollows(userId: string) {
  return db
    .select()
    .from(socialFollows)
    .where(eq(socialFollows.userId, userId))
    .orderBy(desc(socialFollows.createdAt));
}

export async function follow(userId: string, type: unknown, id: unknown) {
  const target = cleanTarget(type, id);
  await db
    .insert(socialFollows)
    .values({ userId, ...target })
    .onConflictDoNothing();
  return target;
}

export async function unfollow(userId: string, type: unknown, id: unknown) {
  const target = cleanTarget(type, id);
  await db
    .delete(socialFollows)
    .where(
      and(
        eq(socialFollows.userId, userId),
        eq(socialFollows.targetType, target.targetType),
        eq(socialFollows.targetId, target.targetId)
      )
    );
}

export async function upsertReview(
  userId: string,
  input: { targetType?: unknown; targetId?: unknown; rating?: unknown; body?: unknown }
) {
  const target = cleanTarget(input.targetType, input.targetId, true);
  const rating = Math.round(Number(input.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ClientError("Hodnocení musí být 1–5");
  const body = cleanText(input.body, 1200) || null;
  const [review] = await db
    .insert(socialReviews)
    .values({ userId, ...target, rating, body })
    .onConflictDoUpdate({
      target: [socialReviews.userId, socialReviews.targetType, socialReviews.targetId],
      set: { rating, body, updatedAt: new Date() }
    })
    .returning();
  return review;
}

export async function listReviews(type: unknown, id: unknown) {
  const target = cleanTarget(type, id, true);
  return db
    .select({
      id: socialReviews.id,
      rating: socialReviews.rating,
      body: socialReviews.body,
      updatedAt: socialReviews.updatedAt,
      author: users.displayName
    })
    .from(socialReviews)
    .innerJoin(users, eq(socialReviews.userId, users.id))
    .where(
      and(
        eq(socialReviews.targetType, target.targetType),
        eq(socialReviews.targetId, target.targetId)
      )
    )
    .orderBy(desc(socialReviews.updatedAt));
}

export async function addComment(
  userId: string,
  input: { targetType?: unknown; targetId?: unknown; body?: unknown }
) {
  const target = cleanTarget(input.targetType, input.targetId);
  const body = cleanText(input.body, 1600);
  if (!body) throw new ClientError("Komentář je prázdný");
  const [comment] = await db
    .insert(socialComments)
    .values({ userId, ...target, body })
    .returning();
  return comment!;
}

export async function listComments(type: unknown, id: unknown) {
  const target = cleanTarget(type, id);
  return db
    .select({
      id: socialComments.id,
      body: socialComments.body,
      createdAt: socialComments.createdAt,
      author: users.displayName
    })
    .from(socialComments)
    .innerJoin(users, eq(socialComments.userId, users.id))
    .where(
      and(
        eq(socialComments.targetType, target.targetType),
        eq(socialComments.targetId, target.targetId)
      )
    )
    .orderBy(desc(socialComments.createdAt));
}

export async function listDrafts(userId: string) {
  const rows = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.userId, userId))
    .orderBy(desc(contentDrafts.updatedAt));
  return rows.map((row) => ({
    ...(row.payload as unknown as ContentDraft),
    id: row.id,
    updatedAt: row.updatedAt.toISOString()
  }));
}

export async function saveDraft(userId: string, input: Partial<ContentDraft>, id?: string) {
  if (id) {
    const [current] = await db
      .select()
      .from(contentDrafts)
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
      .limit(1);
    if (!current) throw new ClientError("Koncept nebyl nalezen", 404);
    const currentDraft = { ...(current.payload as unknown as ContentDraft), id: current.id };
    const payload = reviseDraftPayload(userId, currentDraft, input);
    const [row] = await db
      .update(contentDrafts)
      .set({
        kind: payload.type,
        payload: payload as unknown as Record<string, unknown>,
        updatedAt: new Date()
      })
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
      .returning();
    if (!row) throw new ClientError("Koncept nebyl nalezen", 404);
    return { ...payload, id: row.id, updatedAt: row.updatedAt.toISOString() };
  }
  const payload = createDraftPayload(userId, input);
  const [row] = await db
    .insert(contentDrafts)
    .values({ userId, kind: payload.type, payload: payload as unknown as Record<string, unknown> })
    .returning();
  return { ...payload, id: row!.id, updatedAt: row!.updatedAt.toISOString() };
}

export async function submitDraftForReview(userId: string, id: string) {
  const [current] = await db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
    .limit(1);
  if (!current) throw new ClientError("Koncept nebyl nalezen", 404);
  const currentDraft = { ...(current.payload as unknown as ContentDraft), id: current.id };
  const payload = submitDraftPayload(userId, currentDraft);
  const [row] = await db
    .update(contentDrafts)
    .set({ payload: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
    .returning();
  return { ...payload, id: row!.id, updatedAt: row!.updatedAt.toISOString() };
}

export async function deleteDraft(userId: string, id: string) {
  const rows = await db
    .delete(contentDrafts)
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
    .returning({ id: contentDrafts.id });
  if (!rows.length) throw new ClientError("Koncept nebyl nalezen", 404);
}

export async function socialFeed(
  userId: string | null,
  cursor?: string,
  limit = 20,
  country = "ALL",
  bbox?: Bbox,
  tag?: string
) {
  const offset = Math.max(0, Number(Buffer.from(cursor ?? "MA", "base64url").toString()) || 0);
  const [posts, follows] = await Promise.all([
    getDiscoverPins(country, bbox, tag, Math.min(100, offset + limit + 1)),
    userId ? listFollows(userId) : Promise.resolve([])
  ]);
  const followed = new Set(follows.map((item) => `${item.targetType}:${item.targetId}`));
  const ranked = posts
    .map((post) => {
      const followedLayer = followed.has(`layer:${post.layerId}`);
      const score =
        (followedLayer ? 3 : 0) +
        Math.max(0, 1 - (Date.now() - new Date(post.createdAt).getTime()) / (30 * 86400_000));
      return {
        ...post,
        score,
        reason: followedLayer ? "Vrstva, kterou sleduješ" : "Nové komunitní místo v oblasti"
      };
    })
    .sort((a, b) => b.score - a.score);
  const items = ranked.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor:
      nextOffset < ranked.length ? Buffer.from(String(nextOffset)).toString("base64url") : null
  };
}
