import type { GeoFeature, Place, PlaceSourceId } from "@mapos/layer-sdk";
import { PLACE_SOURCE_BY_ID, featureAnchor, parseSourceRefs } from "@mapos/layer-sdk";
import { apiGetWithMetadata } from "./api";
import { on } from "./events";

/** The identity of a clicked pin, in the terms every info panel needs.
 *
 *  A panel does not care which layer drew the pin; it cares whether this place has an OSM id, a
 *  QID or a Foursquare venue — that is what decides if the panel has anything to show. */
export interface PlaceRefs {
  id: string;
  name: string;
  lng: number;
  lat: number;
  category: string;
  refs: Partial<Record<PlaceSourceId, string>>;
  wikidata: string | null;
  fsqId: string | null;
  revision?: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function placeRefsFromFeature(feature: GeoFeature, layerId: string): PlaceRefs {
  const p = feature.properties;
  const [lng, lat] = featureAnchor(feature);
  const id = str(p.id) ?? `${layerId}:${lng.toFixed(5)},${lat.toFixed(5)}`;

  const refs: Partial<Record<PlaceSourceId, string>> = {};
  for (const { source, ref } of parseSourceRefs(p.sourceRefs)) refs[source] = ref;
  // Layers that never went through fusion still carry their own OSM id.
  refs.osm ??= str(p.osmId) ?? undefined;
  if (layerId === "user-layers") refs.user ??= id;
  // A provider-owned legacy layer may not carry the fused `sourceRefs` string yet. Its stable
  // layer id and feature id are still an honest native reference when that id names a known
  // source (Park4Night/user layers are the current examples).
  if (layerId in PLACE_SOURCE_BY_ID && !refs[layerId as PlaceSourceId]) {
    refs[layerId as PlaceSourceId] = id;
  }

  return {
    id,
    name: str(p.name) ?? "Místo",
    lng,
    lat,
    category: str(p.category) ?? layerId,
    refs,
    wikidata: str(p.wikidata) ?? refs.wikidata ?? null,
    fsqId: str(p.fsqId) ?? refs.fsq ?? null,
    revision: str(p.revision) ?? str(p.updatedAt) ?? undefined
  };
}

export function encodeRefs(refs: PlaceRefs["refs"]): string {
  return Object.entries(refs)
    .filter(([, ref]) => ref)
    .map(([source, ref]) => `${source}:${ref}`)
    .join("|");
}

/** Server-side resolution of the full record. Optional by design: the pin's own properties are
 *  already enough to open the panel, and this only fills in what the map never carried. */
export function fetchPlaceDetail(place: PlaceRefs, signal?: AbortSignal): Promise<Place | null> {
  return fetchPlaceDetailStrict(place, signal).catch(() => null);
}

const details = new Map<string, { place: Place; expires: number; bytes: number }>();
let detailBytes = 0;
let generation = 0;
on("session-changed", () => {
  generation++;
  details.clear();
  detailBytes = 0;
});
function forget(key: string) {
  detailBytes -= details.get(key)?.bytes ?? 0;
  details.delete(key);
}

/** Strict variant for a detail surface that needs to distinguish offline/failure from a genuine
 * empty optional enrichment. The local pin remains renderable while this request fails. */
export async function fetchPlaceDetailStrict(
  place: PlaceRefs,
  signal?: AbortSignal
): Promise<Place> {
  signal?.throwIfAborted();
  const current = generation;
  const key = JSON.stringify([
    place.id,
    place.revision,
    encodeRefs(place.refs),
    place.lng,
    place.lat
  ]);
  const cached = details.get(key);
  if (cached && cached.expires > Date.now()) {
    details.delete(key);
    details.set(key, cached);
    return structuredClone(cached.place);
  }
  forget(key);
  const response = await apiGetWithMetadata<Place>(`/places/${encodeURIComponent(place.id)}`, {
    signal,
    query: {
      sourceRefs: encodeRefs(place.refs),
      lng: place.lng,
      lat: place.lat,
      name: place.name,
      category: place.category
    }
  });
  const result = response.data;
  signal?.throwIfAborted();
  if (current !== generation) throw new DOMException("Session changed", "AbortError");
  const cacheControl = response.cacheControl ?? "";
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl);
  const ttl = Math.min(5 * 60_000, maxAge ? Number(maxAge[1]) * 1000 : 5 * 60_000);
  if (!/no-store|no-cache/i.test(cacheControl) && ttl > 0) {
    const bytes = JSON.stringify(result).length * 2;
    if (bytes <= 4 * 1024 * 1024) {
      forget(key);
      while (details.size >= 100 || detailBytes + bytes > 4 * 1024 * 1024)
        forget(details.keys().next().value!);
      details.set(key, { place: structuredClone(result), expires: Date.now() + ttl, bytes });
      detailBytes += bytes;
    }
  }
  return result;
}
