import {
  buildOverpassQuery,
  type Bbox,
  type FeatureCollection,
  type LinePositions,
  type OsmPoiCategoryId,
  OSM_POI_CATEGORIES
} from "@mapos/layer-sdk";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { osmCells, osmPois, userPins, userLayers } from "../db/schema.js";
import { ClientError, safeErrorLogFields } from "../utils/clientError.js";
import { fetchOverpass } from "../utils/overpass.js";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";
const CELL_TTL_MS = 7 * 24 * 3600_000;
const MAX_FEATURES = 8000;
const MAX_CELLS_PER_REQUEST = 48;
const CELL_FETCH_CONCURRENCY = 6;

export function parseCategories(raw: string | undefined): OsmPoiCategoryId[] {
  const ids = (raw ?? "restaurant,cafe,parking,viewpoint").split(",").filter(Boolean);
  return ids.filter((id): id is OsmPoiCategoryId => id in OSM_POI_CATEGORIES);
}

function demoFeatures(_categories: OsmPoiCategoryId[]): FeatureCollection {
  // Never invent Czech demo pins for empty foreign viewports — that made Spain look "broken"
  // (zero real restaurants, or worse: Plzeň pins floating over Barcelona). Empty is honest.
  return { type: "FeatureCollection", features: [] };
}

function matchCategory(
  tags: Record<string, string>,
  candidates: OsmPoiCategoryId[]
): OsmPoiCategoryId {
  for (const c of candidates) {
    const spec = OSM_POI_CATEGORIES[c].overpass;
    const match = spec.match(/\["([^"]+)"="([^"]+)"\]/);
    if (match && tags[match[1]!] === match[2]) return c;
  }
  return candidates[0]!;
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      try {
        await fn(item);
      } catch (err) {
        console.warn("OSM cell fetch failed", safeErrorLogFields(err));
      }
    }
  });
  await Promise.all(workers);
}

/** Ensures the given z7 cell has fresh Overpass data cached for every requested category —
 * "world-lazy" ingestion: nothing is pre-seeded, cells are only ever fetched the first time a
 * viewport touches them, then reused for 7 days by every other user panning over the same area. */
async function ensureCellFetched(cell: Cell, categories: OsmPoiCategoryId[]) {
  const cId = cellId(cell);
  const rowIds = categories.map((c) => `${cId}:${c}`);
  const existing = await db.select().from(osmCells).where(inArray(osmCells.id, rowIds));
  const fresh = new Set(
    existing.filter((r) => Date.now() - r.fetchedAt.getTime() < CELL_TTL_MS).map((r) => r.category)
  );
  const missing = categories.filter((c) => !fresh.has(c));
  if (!missing.length) return;

  const bbox = cellBounds(cell);
  const query = buildOverpassQuery(bbox, missing);

  let elements: Array<{
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }> = [];
  let ok = false;
  try {
    const data = await fetchOverpass<{ elements?: typeof elements }>(query, { timeoutMs: 30_000 });
    elements = data.elements ?? [];
    ok = true;
  } catch {
    // Leave the cell unmarked so the next request retries after the provider circuit cools down.
  }

  // Leave the cell unmarked on total failure so the next request retries instead of
  // permanently caching an empty result.
  if (!ok) return;

  const rows = elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) return null;
      const tags = el.tags ?? {};
      const category = matchCategory(tags, missing);
      return {
        id: `osm-${el.id}`,
        osmId: String(el.id),
        category,
        name: tags.name ?? tags["name:cs"] ?? null,
        lng,
        lat,
        tags,
        cellId: cId
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await db.delete(osmPois).where(inArray(osmPois.id, ids));
    await db.insert(osmPois).values(rows);
  }

  const cellRows = missing.map((category) => ({ id: `${cId}:${category}`, cellId: cId, category }));
  await db.delete(osmCells).where(
    inArray(
      osmCells.id,
      cellRows.map((r) => r.id)
    )
  );
  await db.insert(osmCells).values(cellRows);
}

export interface OsmElement {
  id: number;
  type: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

/** Looks up a single OSM element by id, across all three element types.
 *
 *  The cached POI rows only keep the numeric id, not whether it was a node, way or relation,
 *  so the union asks for all three and takes whichever exists. */
export async function fetchOsmElement(osmId: string): Promise<OsmElement | null> {
  const id = osmId.replace(/^\D+/, "");
  if (!/^\d+$/.test(id)) return null;
  const query = `[out:json][timeout:20];(node(${id});way(${id});relation(${id}););out center tags 1;`;

  try {
    const data = await fetchOverpass<{
      elements?: Array<{
        id: number;
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    }>(query, { timeoutMs: 20_000 });
    const el = data.elements?.[0];
    const lat = el?.lat ?? el?.center?.lat;
    const lng = el?.lon ?? el?.center?.lon;
    if (!el || lat == null || lng == null) return null;
    return { id: el.id, type: el.type, lat, lng, tags: el.tags ?? {} };
  } catch {
    return null;
  }
}

export async function getOsmPoiFeatures(
  bbox: Bbox,
  categoriesRaw: string | undefined
): Promise<FeatureCollection> {
  const categories = parseCategories(categoriesRaw);
  if (!categories.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const cells = cellsForBbox(bbox, MAX_CELLS_PER_REQUEST);
  await runWithConcurrency(cells, CELL_FETCH_CONCURRENCY, (cell) =>
    ensureCellFetched(cell, categories)
  );

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
    .orderBy(sql`(${osmPois.name} is not null) desc`)
    .limit(MAX_FEATURES);

  if (!rows.length) {
    return demoFeatures(categories);
  }

  const features = rows.map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
    properties: {
      id: r.id,
      name: r.name ?? "Bez názvu",
      category: r.category,
      layerId: "osm-poi",
      osmId: r.osmId,
      ...(r.tags as Record<string, string>)
    }
  }));

  return { type: "FeatureCollection", features };
}

/** Narrows the stored `path` to a drawable line, tolerating the historic rows that predate the
 *  column and anything a hand-edited jsonb might contain. */
function routePath(value: unknown): LinePositions | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const path = value
    .filter(
      (entry): entry is [number, number] =>
        Array.isArray(entry) &&
        entry.length >= 2 &&
        Number.isFinite(Number(entry[0])) &&
        Number.isFinite(Number(entry[1]))
    )
    .map(([lng, lat]): [number, number] => [Number(lng), Number(lat)]);
  // The length check above is what makes the non-empty tuple true; the compiler cannot see it.
  return path.length >= 2 ? (path as LinePositions) : null;
}

export async function getUserLayerFeatures(
  bbox: Bbox,
  userId?: string,
  tag?: string,
  country?: string
): Promise<FeatureCollection> {
  const [w, s, e, n] = bbox;
  const layers = userId
    ? await db.select().from(userLayers).where(eq(userLayers.userId, userId))
    : await db.select().from(userLayers).where(eq(userLayers.isPublic, 1));

  const layerIds = layers.map((l) => l.id);
  if (!layerIds.length) return { type: "FeatureCollection", features: [] };

  const allPins = await db.select().from(userPins);
  const normalizedTag = tag?.trim().toLowerCase();
  /** A route is only anchored at its start, so testing the anchor alone would hide the track as
   *  soon as the user panned past its beginning — exactly when they are following it. */
  const inView = (pin: (typeof allPins)[number]) => {
    const path = routePath(pin.path);
    if (!path) return pin.lng >= w && pin.lng <= e && pin.lat >= s && pin.lat <= n;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of path) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return west <= e && east >= w && south <= n && north >= s;
  };
  const features = allPins
    .filter((p) => layerIds.includes(p.layerId))
    .filter(inView)
    .filter((p) => !normalizedTag || (p.tags ?? []).some((t) => t.toLowerCase() === normalizedTag))
    .filter((p) => !country || country === "ALL" || !p.country || p.country === country)
    .map((p) => {
      const layer = layers.find((l) => l.id === p.layerId);
      const path = routePath(p.path);
      return {
        type: "Feature" as const,
        geometry: path
          ? { type: "LineString" as const, coordinates: path }
          : { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] },
        properties: {
          ...(p.properties && typeof p.properties === "object" ? p.properties : {}),
          id: p.id,
          name: p.name,
          description: p.description ?? "",
          category: "user-pin",
          layerId: "user-layers",
          userLayerId: p.layerId,
          userLayerName: layer?.name ?? "",
          color: layer?.color ?? "#10b981",
          tags: p.tags ?? [],
          kind: p.kind ?? "place",
          country: p.country ?? "",
          authorName: p.authorName ?? "",
          // The client needs somewhere to put the marker and open the detail sheet for a line.
          ...(path ? { anchorLng: p.lng, anchorLat: p.lat } : {})
        }
      };
    });

  return { type: "FeatureCollection", features };
}

export function parseBbox(raw: string | undefined): Bbox {
  if (!raw) throw new ClientError("bbox required");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) throw new ClientError("invalid bbox");
  return parts as Bbox;
}
