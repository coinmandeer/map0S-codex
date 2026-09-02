/** Merges several POI sources into one set of places for a viewport.
 *
 *  The sources answer different questions and none of them is sufficient alone:
 *  - Overpass knows *everything* mapped in OSM, including unnamed amenities, but its naming and
 *    metadata are uneven;
 *  - Mapy.com has excellent named landmarks in Central Europe but no bulk endpoint (see
 *    mapyPoiService for the keyword workaround);
 *  - Wikidata contributes the QID, which is the only reliable cross-source join key that exists.
 *
 *  So the job here is: fetch in parallel, normalize into `Place`, then merge duplicates while
 *  keeping every source's claim in `sources[]` so the UI can show provenance instead of
 *  pretending the data came from nowhere.
 *
 *  Failure is per-source and never fatal: a dead Overpass mirror degrades the result and is
 *  reported in `meta.sources`, which is what drives the loader ring in SourceIconStrip.
 */

import type {
  Bbox,
  OsmPoiCategoryId,
  Place,
  PlaceSourceId,
  PlacesResponse,
  PlacesSourceMeta
} from "@mapos/layer-sdk";
import { PLACE_SOURCE_BY_ID, distanceMeters } from "@mapos/layer-sdk";
import { getOsmPoiFeatures, getUserLayerFeatures } from "./layerService.js";
import { getMapyPois } from "./mapyPoiService.js";
import { getPark4nightFeatures } from "./park4nightService.js";
import { loadWikipediaPois } from "./discoverService.js";
import { config } from "../config.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { fetchJson } from "../utils/upstream.js";

/** Two entries closer than this with a similar name are treated as the same place. Chosen to
 *  absorb the offset between an OSM building centroid and a Mapy entrance pin without merging
 *  neighbouring shops on a high street. */
const MERGE_RADIUS_M = 75;

export interface FusionQuery {
  bbox: Bbox;
  categories: OsmPoiCategoryId[];
  sources: PlaceSourceId[];
}

/**
 * One upstream MapOS can ask for places.
 *
 * Adding a source means adding an adapter to `PLACE_SOURCE_ADAPTERS`, not another `if` in
 * `getFusedPlaces` — the fetch, its trust level and the reason it might be unavailable all live
 * together instead of being spread across three lists that have to agree.
 */
export interface PlaceSourceAdapter {
  id: PlaceSourceId;
  /** How much this source's claim is trusted when two sources disagree on a field. */
  confidence: number;
  /** Why this source can't run here (missing key, needs a local import), or null when it can.
   *  A skipped source is reported to the client rather than silently missing. */
  unavailableReason?(): string | null;
  fetch(query: FusionQuery): Promise<Place[]>;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Names match when one contains the other as a whole — "Hrad Okoř" vs "Okoř" — which is the
 *  usual shape of disagreement between sources naming the same landmark. */
function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 4 && longer.includes(shorter);
}

function provenance(source: PlaceSourceId, sourceRef: string) {
  return {
    source,
    sourceRef,
    confidence: adapterFor(source)?.confidence ?? 0.5,
    refreshedAt: new Date().toISOString()
  };
}

/** Later claims fill gaps but never overwrite a field a more confident source already set. */
function mergeInto(target: Place, incoming: Place) {
  const incomingConfidence = incoming.sources[0]?.confidence ?? 0;
  const targetConfidence = target.sources[0]?.confidence ?? 0;

  if (incomingConfidence > targetConfidence && incoming.name) target.name = incoming.name;
  target.wikidata ??= incoming.wikidata;
  target.address ??= incoming.address;
  target.photo ??= incoming.photo;
  target.rating ??= incoming.rating;
  target.ratingCount ??= incoming.ratingCount;
  target.website ??= incoming.website;
  target.phone ??= incoming.phone;
  target.openingHours ??= incoming.openingHours;
  target.elevationM ??= incoming.elevationM;
  if (incoming.tags?.length) {
    target.tags = [...new Set([...(target.tags ?? []), ...incoming.tags])];
  }
  target.sources.push(...incoming.sources);
  target.sources.sort((a, b) => b.confidence - a.confidence);
}

/** Grid bucketing keeps dedupe near-linear: only places within one cell of each other are ever
 *  compared, instead of every pair in a viewport that can hold thousands. */
function dedupe(places: Place[]): { merged: Place[]; dropped: number } {
  const cellSize = 0.002; // ~200 m of latitude, comfortably above MERGE_RADIUS_M
  const buckets = new Map<string, Place[]>();
  const out: Place[] = [];
  let dropped = 0;

  for (const place of places) {
    const gx = Math.floor(place.lng / cellSize);
    const gy = Math.floor(place.lat / cellSize);
    let match: Place | undefined;

    for (let dx = -1; dx <= 1 && !match; dx += 1) {
      for (let dy = -1; dy <= 1 && !match; dy += 1) {
        for (const candidate of buckets.get(`${gx + dx}:${gy + dy}`) ?? []) {
          const sameQid = Boolean(place.wikidata && place.wikidata === candidate.wikidata);
          const near = distanceMeters(place, candidate) <= MERGE_RADIUS_M;
          if (sameQid || (near && namesMatch(place.name, candidate.name))) {
            match = candidate;
            break;
          }
        }
      }
    }

    if (match) {
      mergeInto(match, place);
      dropped += 1;
      continue;
    }

    const key = `${gx}:${gy}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(place);
    else buckets.set(key, [place]);
    out.push(place);
  }

  return { merged: out, dropped };
}

async function timed<T>(
  source: PlaceSourceId,
  fn: () => Promise<T[]>
): Promise<{ places: T[]; meta: PlacesSourceMeta }> {
  const started = Date.now();
  try {
    const places = await fn();
    return {
      places,
      meta: { source, state: "ready", count: places.length, tookMs: Date.now() - started }
    };
  } catch (err) {
    console.warn(`Place source ${source} failed`, safeErrorLogFields(err));
    return {
      places: [],
      meta: {
        source,
        state: "error",
        count: 0,
        message: `Zdroj ${PLACE_SOURCE_BY_ID[source].label} je dočasně nedostupný`,
        tookMs: Date.now() - started
      }
    };
  }
}

async function fetchOsm(bbox: Bbox, categories: OsmPoiCategoryId[]): Promise<Place[]> {
  const fc = await getOsmPoiFeatures(bbox, categories.join(","));
  return fc.features.map((f) => {
    const props = f.properties as Record<string, string>;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    return {
      id: `osm:${props.id}`,
      name: props.name ?? "Bez názvu",
      lng,
      lat,
      category: props.category ?? "poi",
      wikidata: props.wikidata,
      website: props.website,
      phone: props.phone,
      openingHours: props.opening_hours,
      elevationM: props.ele ? Number(props.ele) : undefined,
      sources: [provenance("osm", props.osmId ?? props.id ?? "")]
    } satisfies Place;
  });
}

async function fetchMapy(bbox: Bbox, categories: OsmPoiCategoryId[]): Promise<Place[]> {
  const result = await getMapyPois(bbox, categories);
  return result.places.map((p) => ({
    id: `mapy:${p.id}`,
    name: p.name,
    lng: p.lng,
    lat: p.lat,
    category: p.category,
    address: p.location ?? undefined,
    sources: [provenance("mapy", p.id)]
  }));
}

async function fetchUser(bbox: Bbox): Promise<Place[]> {
  // The fused `user` source is the public community catalogue. A signed-in visitor must see the
  // same catalogue as everyone else; their private/editable pins belong to `user-layers`.
  const fc = await getUserLayerFeatures(bbox);
  return fc.features.map((f) => {
    const props = f.properties as Record<string, unknown>;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    return {
      id: `user:${String(props.id)}`,
      name: String(props.name ?? "Pin"),
      lng,
      lat,
      category: "user-pin",
      tags: Array.isArray(props.tags) ? (props.tags as string[]) : undefined,
      sources: [provenance("user", String(props.id))]
    } satisfies Place;
  });
}

async function fetchPark4night(bbox: Bbox): Promise<Place[]> {
  const fc = await getPark4nightFeatures(bbox);
  return fc.features.map((f) => {
    const props = f.properties as Record<string, unknown>;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    return {
      id: `park4night:${String(props.id)}`,
      name: String(props.name ?? "Spot"),
      lng,
      lat,
      category: "camp_site",
      photo: props.photoThumb ? String(props.photoThumb) : undefined,
      rating: typeof props.rating === "number" ? props.rating : undefined,
      ratingCount: typeof props.reviews === "number" ? props.reviews : undefined,
      sources: [provenance("park4night", String(props.id))]
    } satisfies Place;
  });
}

async function fetchWikipedia(bbox: Bbox): Promise<Place[]> {
  const [west, south, east, north] = bbox;
  const articles = await loadWikipediaPois({ west, south, east, north });
  return articles.map((a) => ({
    id: `wikipedia:${a.pageId}`,
    name: a.title,
    lng: a.lng,
    lat: a.lat,
    category: "wikipedia",
    sources: [provenance("wikipedia", String(a.pageId))]
  }));
}

/** Significant places from Wikidata via its SPARQL endpoint. Its value is less the places
 *  themselves than the QIDs, which let the merge step recognise the same landmark across
 *  sources that share no other identifier. */
async function fetchWikidata(bbox: Bbox): Promise<Place[]> {
  const [west, south, east, north] = bbox;
  const query = `SELECT ?item ?itemLabel ?coord WHERE {
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral .
    }
    ?item wdt:P31/wdt:P279* ?type .
    VALUES ?type { wd:Q23413 wd:Q751876 wd:Q33506 wd:Q57821 wd:Q1440300 wd:Q8502 }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "cs,en,de" }
  } LIMIT 200`;

  const data = await fetchJson<{
    results?: {
      bindings?: Array<{
        item?: { value: string };
        itemLabel?: { value: string };
        coord?: { value: string };
      }>;
    };
  }>("https://query.wikidata.org/sparql", {
    providerId: "wikidata",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json"
    },
    body: `query=${encodeURIComponent(query)}`,
    timeoutMs: 15_000,
    ttlMs: 6 * 60 * 60_000,
    minIntervalMs: 250,
    retries: 2
  });

  return (data.results?.bindings ?? [])
    .map((row): Place | null => {
      const match = row.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      const qid = row.item?.value.split("/").pop();
      if (!match || !qid || !row.itemLabel?.value) return null;
      return {
        id: `wikidata:${qid}`,
        name: row.itemLabel.value,
        lng: Number(match[1]),
        lat: Number(match[2]),
        category: "landmark",
        wikidata: qid,
        sources: [provenance("wikidata", qid)]
      };
    })
    .filter((p): p is Place => p !== null);
}

/** The registry. Order here is irrelevant — sources are fetched in parallel and the merge step
 *  sorts by confidence — but keeping it roughly most- to least-trusted reads better. */
export const PLACE_SOURCE_ADAPTERS: PlaceSourceAdapter[] = [
  {
    id: "user",
    confidence: 0.95,
    fetch: ({ bbox }) => fetchUser(bbox)
  },
  {
    id: "mapy",
    confidence: 0.8,
    unavailableReason: () => (config.mapyKey ? null : "chybí MAPY_API_KEY"),
    fetch: ({ bbox, categories }) => fetchMapy(bbox, categories)
  },
  {
    id: "osm",
    confidence: 0.75,
    fetch: ({ bbox, categories }) => fetchOsm(bbox, categories)
  },
  {
    id: "wikidata",
    confidence: 0.7,
    fetch: ({ bbox }) => fetchWikidata(bbox)
  },
  {
    id: "park4night",
    confidence: 0.6,
    unavailableReason: () =>
      config.park4nightEnabled ? null : "vypnuto operátorem (PARK4NIGHT_ENABLED=1 jej zapne)",
    fetch: ({ bbox }) => fetchPark4night(bbox)
  },
  {
    id: "overture",
    confidence: 0.6,
    unavailableReason: () => "vyžaduje lokální import",
    fetch: async () => []
  },
  {
    id: "fsq",
    confidence: 0.5,
    // Foursquare's bulk search is not part of the free tier; it enriches a single place on
    // demand instead (see placeEnrichmentService).
    unavailableReason: () => "jen doplňuje detail místa",
    fetch: async () => []
  },
  {
    id: "wikipedia",
    confidence: 0.4,
    fetch: ({ bbox }) => fetchWikipedia(bbox)
  }
];

const ADAPTERS_BY_ID = new Map(PLACE_SOURCE_ADAPTERS.map((a) => [a.id, a]));

export function adapterFor(id: PlaceSourceId): PlaceSourceAdapter | undefined {
  return ADAPTERS_BY_ID.get(id);
}

export async function getFusedPlaces(query: FusionQuery): Promise<PlacesResponse> {
  const wanted = new Set(query.sources);
  const metas: PlacesSourceMeta[] = [];
  const jobs: Promise<{ places: Place[]; meta: PlacesSourceMeta }>[] = [];

  for (const adapter of PLACE_SOURCE_ADAPTERS) {
    if (!wanted.has(adapter.id)) continue;
    const reason = adapter.unavailableReason?.();
    if (reason) {
      metas.push({ source: adapter.id, state: "skipped", count: 0, message: reason });
      continue;
    }
    jobs.push(timed(adapter.id, () => adapter.fetch(query)));
  }

  const settled = await Promise.all(jobs);
  for (const result of settled) metas.push(result.meta);

  // Highest-confidence sources first, so dedupe keeps their record as the surviving one.
  const all = settled
    .flatMap((r) => r.places)
    .sort((a, b) => (b.sources[0]?.confidence ?? 0) - (a.sources[0]?.confidence ?? 0));

  const { merged, dropped } = dedupe(all);

  return {
    places: merged,
    meta: {
      sources: metas.sort(
        (a, b) =>
          Object.keys(PLACE_SOURCE_BY_ID).indexOf(a.source) -
          Object.keys(PLACE_SOURCE_BY_ID).indexOf(b.source)
      ),
      merged: dropped
    }
  };
}

export const __testing = { dedupe, namesMatch, normalizeName };
