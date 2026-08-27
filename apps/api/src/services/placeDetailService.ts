/** Resolves one place, by id, into the full `Place` the info engine renders.
 *
 *  Fused places are computed per viewport and never stored, so an id on its own is not a
 *  database key — it is a reference into whichever upstream produced it. This service turns that
 *  reference back into a record: it asks the owning source for the canonical fields, then lets
 *  the enrichment sources fill the gaps.
 *
 *  Adding a source that can answer "tell me about this one place" means adding a
 *  `PlaceResolver`, the read-side counterpart to `PlaceSourceAdapter`.
 */

import type { Place, PlaceProvenance, PlaceSourceId } from "@mapos/layer-sdk";
import { parseSourceRefs } from "@mapos/layer-sdk";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userPins } from "../db/schema.js";
import { fetchOsmElement } from "./layerService.js";
import { enrichPlace } from "./placeEnrichmentService.js";
import { adapterFor } from "./poiFusionService.js";
import { config } from "../config.js";
import { fetchJson } from "../utils/upstream.js";

/** What one source can tell us about a place it owns. Coordinates are required: a resolver that
 *  cannot place the record on the map has not resolved anything useful. */
export type ResolvedPlace = Omit<Place, "id" | "sources">;

export interface PlaceResolver {
  source: PlaceSourceId;
  resolve(ref: string): Promise<ResolvedPlace | null>;
}

async function resolveOsm(ref: string): Promise<ResolvedPlace | null> {
  const el = await fetchOsmElement(ref);
  if (!el) return null;
  const t = el.tags;
  return {
    name: t.name ?? t["name:cs"] ?? "Bez názvu",
    lng: el.lng,
    lat: el.lat,
    category: t.amenity ?? t.tourism ?? t.leisure ?? t.shop ?? t.historic ?? "poi",
    wikidata: t.wikidata,
    address:
      [t["addr:street"], t["addr:housenumber"], t["addr:city"]].filter(Boolean).join(" ") ||
      undefined,
    website: t.website ?? t["contact:website"],
    phone: t.phone ?? t["contact:phone"],
    openingHours: t.opening_hours,
    elevationM: t.ele ? Number(t.ele) : undefined
  };
}

async function resolveWikidata(qid: string): Promise<ResolvedPlace | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const data = await fetchJson<{
    entities?: Record<
      string,
      {
        labels?: Record<string, { value: string }>;
        claims?: Record<
          string,
          Array<{
            mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } };
          }>
        >;
      }
    >;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|claims&languages=cs|en|de&format=json&origin=*`,
    { source: "wikidata", ttlMs: 24 * 3600_000 }
  );

  const entity = data.entities?.[qid];
  const coord = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  if (!entity || coord?.latitude == null || coord.longitude == null) return null;
  const label =
    entity.labels?.cs?.value ?? entity.labels?.en?.value ?? entity.labels?.de?.value ?? qid;

  return {
    name: label,
    lng: coord.longitude,
    lat: coord.latitude,
    category: "landmark",
    wikidata: qid
  };
}

async function resolveUserPin(ref: string): Promise<ResolvedPlace | null> {
  const [pin] = await db.select().from(userPins).where(eq(userPins.id, ref)).limit(1);
  if (!pin) return null;
  return {
    name: pin.name ?? "Pin",
    lng: pin.lng,
    lat: pin.lat,
    category: "user-pin",
    tags: Array.isArray(pin.tags) ? (pin.tags as string[]) : undefined
  };
}

export const PLACE_RESOLVERS: PlaceResolver[] = [
  { source: "osm", resolve: resolveOsm },
  { source: "wikidata", resolve: resolveWikidata },
  { source: "user", resolve: resolveUserPin }
];

const RESOLVER_BY_SOURCE = new Map(PLACE_RESOLVERS.map((r) => [r.source, r]));

export interface PlaceDetailQuery {
  /** `${source}:${sourceRef}` — the id the map pin carries. */
  id: string;
  /** The pin's full `sourceRefs`, so every source that contributed stays addressable. */
  sourceRefs?: string;
  /** Coordinates from the clicked pin. They let the detail work even when no resolver owns the
   *  id — a data layer's point, say — and they save a round trip when one does. */
  lng?: number;
  lat?: number;
  name?: string;
  category?: string;
}

function refsFor(query: PlaceDetailQuery): Array<{ source: PlaceSourceId; ref: string }> {
  const parsed = parseSourceRefs(query.sourceRefs);
  if (parsed.length) return parsed;
  const own = parseSourceRefs(query.id);
  return own;
}

function provenanceFor(refs: Array<{ source: PlaceSourceId; ref: string }>): PlaceProvenance[] {
  const now = new Date().toISOString();
  return refs
    .map((r) => ({
      source: r.source,
      sourceRef: r.ref,
      confidence: adapterFor(r.source)?.confidence ?? 0.5,
      refreshedAt: now
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export interface PlaceDetailOptions {
  /** Substituted in tests so resolving a place never depends on Overpass being up. */
  resolvers?: PlaceResolver[];
}

/** Returns null only when nothing — neither a resolver nor the caller's hints — can say where
 *  the place is; the info engine turns that into a 404 rather than an empty panel. */
export async function getPlaceDetail(
  query: PlaceDetailQuery,
  options: PlaceDetailOptions = {}
): Promise<Place | null> {
  const refs = refsFor(query);
  const bySource = options.resolvers
    ? new Map(options.resolvers.map((r) => [r.source, r]))
    : RESOLVER_BY_SOURCE;

  let base: ResolvedPlace | null = null;
  for (const { source, ref } of refs) {
    const resolver = bySource.get(source);
    if (!resolver) continue;
    try {
      base = await resolver.resolve(ref);
    } catch {
      base = null;
    }
    if (base) break;
  }

  const lng = base?.lng ?? query.lng;
  const lat = base?.lat ?? query.lat;
  if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const place: Place = {
    id: query.id,
    name: base?.name ?? query.name ?? "Místo",
    lng,
    lat,
    category: base?.category ?? query.category ?? "poi",
    wikidata: base?.wikidata ?? refs.find((r) => r.source === "wikidata")?.ref,
    address: base?.address,
    photo: base?.photo,
    website: base?.website,
    phone: base?.phone,
    openingHours: base?.openingHours,
    elevationM: base?.elevationM,
    tags: base?.tags,
    sources: provenanceFor(refs)
  };

  // Foursquare is enrichment-only (see PLACE_SOURCE_ADAPTERS): it never answers a viewport, but
  // it is the one source with ratings, tips and street-level photos.
  if (config.fsqKey) {
    const osmRef = refs.find((r) => r.source === "osm")?.ref;
    const extra = await enrichPlace({
      lng: place.lng,
      lat: place.lat,
      name: place.name,
      category: place.category,
      osmId: osmRef
    });
    place.fsqId = extra.fsqId ?? undefined;
    place.address ??= extra.address ?? undefined;
    place.rating ??= extra.rating ?? undefined;
    place.ratingCount ??= extra.ratingCount ?? undefined;
    place.photo ??= extra.photos[0];
    if (extra.fsqId) {
      place.sources.push({
        source: "fsq",
        sourceRef: extra.fsqId,
        confidence: adapterFor("fsq")?.confidence ?? 0.5,
        refreshedAt: new Date().toISOString()
      });
    }
  }

  return place;
}
