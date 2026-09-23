import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { placeEnrichment } from "../db/schema.js";

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

export async function enrichPlace(
  input: {
    lng: number;
    lat: number;
    name?: string;
    category?: string;
    osmId?: string;
  },
  signal?: AbortSignal
): Promise<PlaceEnrichment> {
  signal?.throwIfAborted();
  const id = cacheKey(input.osmId, input.lng, input.lat, input.name ?? "");
  const [cached] = await db
    .select()
    .from(placeEnrichment)
    .where(eq(placeEnrichment.id, id))
    .limit(1);
  if (cached) return fromPayload(cached.payload);
  // Commercial enrichment is explicit in the Foursquare panel and budgeted there.
  // Preserve previously saved references, but never discover or enrich every map pin automatically.
  signal?.throwIfAborted();
  return EMPTY;
}
