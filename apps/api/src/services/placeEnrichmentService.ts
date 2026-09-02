import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { placeEnrichment } from "../db/schema.js";
import { fetchJson } from "../utils/upstream.js";

export interface PlaceEnrichment {
  fsqId: string | null;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  photos: string[];
  tips: Array<{ text: string }>;
}

const EMPTY: PlaceEnrichment = {
  fsqId: null,
  address: null,
  rating: null,
  ratingCount: null,
  photos: [],
  tips: []
};

function cacheKey(osmId: string | undefined, lng: number, lat: number, name: string): string {
  if (osmId) return `osm:${osmId}`;
  return `geo:${lng.toFixed(5)},${lat.toFixed(5)}:${name.slice(0, 40)}`;
}

function asPayload(value: PlaceEnrichment): Record<string, unknown> {
  return { ...value };
}

function fromPayload(value: Record<string, unknown>): PlaceEnrichment {
  const v = value as unknown as PlaceEnrichment;
  return {
    fsqId: v.fsqId ?? null,
    address: v.address ?? null,
    rating: v.rating ?? null,
    ratingCount: v.ratingCount ?? null,
    photos: Array.isArray(v.photos) ? v.photos : [],
    tips: Array.isArray(v.tips) ? v.tips : []
  };
}

function photoUrl(prefix: string, suffix: string): string {
  return `${prefix}300x300${suffix}`;
}

async function fsqGet(path: string, key: string): Promise<unknown | null> {
  try {
    return await fetchJson<unknown>(`https://api.foursquare.com/v3${path}`, {
      providerId: "foursquare-legacy-enrichment",
      headers: { Authorization: key },
      ttlMs: 6 * 60 * 60_000,
      timeoutMs: 8_000,
      maxResponseBytes: 2 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

export async function enrichPlace(input: {
  lng: number;
  lat: number;
  name?: string;
  category?: string;
  osmId?: string;
}): Promise<PlaceEnrichment> {
  const key = process.env.FSQ_API_KEY?.trim();
  const id = cacheKey(input.osmId, input.lng, input.lat, input.name ?? "");
  const [cached] = await db
    .select()
    .from(placeEnrichment)
    .where(eq(placeEnrichment.id, id))
    .limit(1);
  if (cached) return fromPayload(cached.payload);
  if (!key) return EMPTY;

  const ll = `${input.lat},${input.lng}`;
  const query = encodeURIComponent(input.name || input.category || "place");
  const search = (await fsqGet(
    `/places/search?ll=${ll}&query=${query}&limit=1&radius=250`,
    key
  )) as {
    results?: Array<{
      fsq_id: string;
      location?: { formatted_address?: string; address?: string; locality?: string };
    }>;
  } | null;

  const hit = search?.results?.[0];
  if (!hit?.fsq_id) {
    await db
      .insert(placeEnrichment)
      .values({ id, payload: asPayload(EMPTY) })
      .onConflictDoNothing();
    return EMPTY;
  }

  const [details, photosRaw, tipsRaw] = await Promise.all([
    fsqGet(`/places/${hit.fsq_id}?fields=rating,stats,location,name`, key) as Promise<{
      rating?: number;
      stats?: { total_ratings?: number };
      location?: { formatted_address?: string };
    } | null>,
    fsqGet(`/places/${hit.fsq_id}/photos?limit=4`, key) as Promise<Array<{
      prefix: string;
      suffix: string;
    }> | null>,
    fsqGet(`/places/${hit.fsq_id}/tips?limit=3`, key) as Promise<Array<{ text: string }> | null>
  ]);

  const payload: PlaceEnrichment = {
    fsqId: hit.fsq_id,
    address:
      details?.location?.formatted_address ??
      hit.location?.formatted_address ??
      ([hit.location?.address, hit.location?.locality].filter(Boolean).join(", ") || null),
    rating: typeof details?.rating === "number" ? details.rating : null,
    ratingCount: details?.stats?.total_ratings ?? null,
    photos: (photosRaw ?? []).slice(0, 4).map((p) => photoUrl(p.prefix, p.suffix)),
    tips: (tipsRaw ?? [])
      .slice(0, 3)
      .map((t) => ({ text: t.text }))
      .filter((t) => t.text)
  };

  await db
    .insert(placeEnrichment)
    .values({ id, payload: asPayload(payload) })
    .onConflictDoNothing();
  return payload;
}
