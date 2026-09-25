import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Bbox, FeatureCollection } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { park4nightCells, park4nightPlaces } from "../db/schema.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";
import { fetchJson } from "../utils/upstream.js";

/**
 * Park4Night, read through the endpoint their mobile app uses.
 *
 * Two things are worth knowing before touching this file.
 *
 * First, the endpoint answers `{"api_infos": "This data is not public, STOP your parsing"}` and is
 * not a stable public API. The checked-in source-rights record preserves that warning, but the
 * prototype operator explicitly made it advisory. `PARK4NIGHT_ENABLED=1` is therefore the sole
 * runtime switch; request pacing, response-size limits and graceful fallback still apply.
 *
 * Second, the response is an object with the places under `lieux`, not the bare array this module
 * was written against. `Array.isArray(data) ? data : []` meant the layer had been quietly
 * returning nothing at all.
 */

const P4N_ENDPOINT = "https://guest.park4night.com/services/V4.1/lieuxGetFilter.php";
const CELL_TTL_MS = 7 * 24 * 3600_000;
/**
 * The endpoint answers with the hundred places nearest the point, which around Plzeň reaches
 * about 20 km. A zoom-8 cell is five times that across, so asking once at its centre left most
 * of the cell unvisited while marking it fetched; zoom 11 is roughly the radius one call covers.
 */
const CELL_ZOOM = 11;
/** One request per second, so this also caps how long a cold viewport waits. */
const MAX_CELLS = 6;

/** Park4Night's public API is unofficial and has no documented rate limits — be a polite
 * neighbour and never issue more than one request per second. */
async function rateLimitedFetch(url: string): Promise<unknown | null> {
  try {
    return await fetchJson<unknown>(url, {
      providerId: "park4night",
      ttlMs: 60 * 60_000,
      timeoutMs: 8_000,
      minIntervalMs: 1_000,
      maxResponseBytes: 2 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

/**
 * Their place codes, of which the three this once handled are a small minority — around a third
 * of a typical response used to land in "other". `P` is a plain car park, `PN` one you may sleep
 * at, `AR` a motorhome service point, `ACC_*` paid accommodation of various kinds.
 */
const CODE_CATEGORIES: Record<string, string> = {
  C: "p4n-camping",
  CS: "p4n-camping",
  P: "p4n-parking",
  PJ: "p4n-parking",
  PSS: "p4n-parking",
  PN: "p4n-night",
  DS: "p4n-night",
  A: "p4n-aire",
  AR: "p4n-aire",
  APN: "p4n-aire",
  ACC_P: "p4n-accommodation",
  ACC_PR: "p4n-accommodation",
  ACC_G: "p4n-accommodation",
  ACC_C: "p4n-accommodation"
};

function codeToCategory(code: string | undefined): string {
  return (code && CODE_CATEGORIES[code]) ?? "p4n-other";
}

interface P4nPlace {
  id: string;
  latitude: string;
  longitude: string;
  titre?: string;
  name?: string;
  code?: string;
  note_moyenne?: string;
  nb_commentaires?: string;
  point_eau?: string;
  electricite?: string;
  wifi?: string;
  douche?: string;
  wc_public?: string;
  photos?: Array<{ link_thumb?: string }>;
}

/** Exported for the test: the shape of the envelope is the whole reason this layer was blank. */
export function parsePark4nightResponse(data: unknown): P4nPlace[] {
  if (Array.isArray(data)) return data as P4nPlace[];
  if (data && typeof data === "object") {
    const places = (data as { lieux?: unknown }).lieux;
    if (Array.isArray(places)) return places as P4nPlace[];
  }
  return [];
}

async function fetchAroundPoint(lat: number, lng: number): Promise<P4nPlace[]> {
  const data = await rateLimitedFetch(`${P4N_ENDPOINT}?latitude=${lat}&longitude=${lng}`);
  return parsePark4nightResponse(data);
}

async function ensureCellFetched(cell: Cell) {
  const cId = cellId(cell);
  const [existing] = await db
    .select()
    .from(park4nightCells)
    .where(eq(park4nightCells.cellId, cId))
    .limit(1);
  if (existing && Date.now() - existing.fetchedAt.getTime() < CELL_TTL_MS) return;

  const [w, s, e, n] = cellBounds(cell);
  const places = await fetchAroundPoint((s + n) / 2, (w + e) / 2);

  const rows = places
    .map((p) => ({ p, lat: Number(p.latitude), lng: Number(p.longitude) }))
    .filter(
      ({ lat, lng }) =>
        Number.isFinite(lat) && Number.isFinite(lng) && lat >= s && lat <= n && lng >= w && lng <= e
    )
    .map(({ p, lat, lng }) => {
      const services: string[] = [];
      if (p.point_eau === "1") services.push("water");
      if (p.electricite === "1") services.push("electricity");
      if (p.wifi === "1") services.push("wifi");
      if (p.douche === "1") services.push("shower");
      if (p.wc_public === "1") services.push("toilets");
      return {
        id: `p4n-${p.id}`,
        name: p.name || p.titre || null,
        code: codeToCategory(p.code),
        lng,
        lat,
        rating: p.note_moyenne ? Number(p.note_moyenne) : null,
        reviews: p.nb_commentaires ? Number(p.nb_commentaires) : 0,
        services,
        photoThumb: p.photos?.[0]?.link_thumb ?? null,
        cellId: cId
      };
    });

  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await db.delete(park4nightPlaces).where(inArray(park4nightPlaces.id, ids));
    await db.insert(park4nightPlaces).values(rows);
  }

  await db.delete(park4nightCells).where(eq(park4nightCells.id, cId));
  await db.insert(park4nightCells).values({ id: cId, cellId: cId });
}

/** The categories the codes above collapse into. Exported so the layer manifest and the filter
 *  parser cannot drift apart from what `codeToCategory` can actually produce. */
export const PARK4NIGHT_CATEGORIES = [
  "p4n-camping",
  "p4n-aire",
  "p4n-parking",
  "p4n-night",
  "p4n-accommodation",
  "p4n-other"
] as const;

/** The five amenity flags the upstream record carries, with the words a reader sees.
 *
 *  The ids are the filter's vocabulary and travel in the query string; the labels are for the
 *  detail sheet. Both are emitted because a sheet listing "water, electricity" is the kind of
 *  developer-facing text §21 exists to remove, and translating an enum inside the generic detail
 *  model would put presentation in the wrong layer. */
const SERVICE_LABELS: Record<string, string> = {
  water: "Voda",
  electricity: "Elektřina",
  wifi: "Wi‑Fi",
  shower: "Sprcha",
  toilets: "WC"
};

export const PARK4NIGHT_SERVICES = Object.keys(SERVICE_LABELS);

export interface Park4nightFilters {
  categories?: string[];
  /** All of these must be present, not any — someone filtering for electricity and a shower
   *  wants both, and a list of places with one of the two is not an answer. */
  services?: string[];
  minRating?: number;
}

function knownValues(raw: string | undefined, allowed: readonly string[]): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value));
}

/** Parses the query string the layer's filters produce. Unknown values are dropped rather than
 *  passed to SQL, so a hand-edited URL cannot widen the query. */
export function parsePark4nightFilters(
  query: Record<string, string | undefined>
): Park4nightFilters {
  const rating = Number(query.minRating);
  return {
    categories: knownValues(query.categories, PARK4NIGHT_CATEGORIES),
    services: knownValues(query.services, PARK4NIGHT_SERVICES),
    ...(Number.isFinite(rating) && rating > 0 ? { minRating: Math.min(rating, 5) } : {})
  };
}

export async function getPark4nightFeatures(
  bbox: Bbox,
  filters: Park4nightFilters = {}
): Promise<FeatureCollection> {
  if (!config.park4nightEnabled) {
    return {
      type: "FeatureCollection",
      features: [],
      notice:
        "Park4Night je blokovaný — chybí předchozí výslovné oprávnění provozovatele dle GTCU čl. 5."
    };
  }

  const cells = cellsForBbox(bbox, MAX_CELLS, CELL_ZOOM);
  for (const cell of cells) {
    await ensureCellFetched(cell).catch((err) =>
      console.warn("Park4Night cell fetch failed", safeErrorLogFields(err))
    );
  }

  const [w, s, e, n] = bbox;
  const rows = await db
    .select()
    .from(park4nightPlaces)
    .where(
      and(
        gte(park4nightPlaces.lng, w),
        lte(park4nightPlaces.lng, e),
        gte(park4nightPlaces.lat, s),
        lte(park4nightPlaces.lat, n),
        // Filtering in SQL rather than after the fact matters because of the row limit below:
        // narrowing in JS would cap at 1000 unfiltered rows first and then hand back a handful,
        // so a filter would look like an empty map.
        ...(filters.categories?.length ? [inArray(park4nightPlaces.code, filters.categories)] : []),
        ...(filters.minRating != null ? [gte(park4nightPlaces.rating, filters.minRating)] : []),
        // `@>` on a jsonb array is containment, which is the "all of these" the field means.
        ...(filters.services?.length
          ? [sql`${park4nightPlaces.services} @> ${JSON.stringify(filters.services)}::jsonb`]
          : [])
      )
    )
    .limit(1000);

  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
      properties: {
        id: r.id,
        name: r.name ?? "Park4Night místo",
        category: r.code ?? "p4n-other",
        layerId: "park4night",
        rating: r.rating ?? undefined,
        reviews: r.reviews ?? 0,
        services: r.services ?? [],
        serviceLabels: (r.services ?? [])
          .map((service) => SERVICE_LABELS[service])
          .filter((label): label is string => Boolean(label)),
        photo: r.photoThumb ?? undefined,
        externalUrl: `https://park4night.com/en/place/${r.id.replace("p4n-", "")}`
      }
    }))
  };
}
