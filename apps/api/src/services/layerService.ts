import { areaPredicate } from "../geo/areaSelection.js";
import type { AreaSelection } from "@mapos/layer-sdk";
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
import { ClientError } from "../utils/clientError.js";
import { fetchOverpass } from "../utils/overpass.js";
import { BackgroundQueue } from "../utils/backgroundQueue.js";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";
const CELL_TTL_MS = 7 * 24 * 3600_000;
const MAX_FEATURES = 8000;
const MAX_CELLS_PER_REQUEST = 48;
const osmIngestion = new BackgroundQueue(2, 96, 30_000);

export function parseCategories(raw: string | undefined): OsmPoiCategoryId[] {
  const ids = (raw ?? "restaurant,cafe,parking,viewpoint").split(",").filter(Boolean);
  return ids.filter((id): id is OsmPoiCategoryId => id in OSM_POI_CATEGORIES);
}

function matchCategory(
  tags: Record<string, string>,
  candidates: OsmPoiCategoryId[]
): OsmPoiCategoryId {
  // The broad `shop` category and the dedicated cannabis layer share OSM ids in one table.
  // Keep cannabis rows in their specific category whichever cell request arrived last.
  if (tags.shop === "cannabis") return "cannabis";
  for (const c of candidates) {
    const spec = OSM_POI_CATEGORIES[c].overpass;
    const match = spec.match(/\["([^"]+)"="([^"]+)"\]/);
    if (match && tags[match[1]!] === match[2]) return c;
  }
  return candidates[0]!;
}

/** Ensures the given z9 cell has fresh Overpass data cached for every requested category —
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
    type: "node" | "way" | "relation";
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
  if (!ok) throw new Error("OSM ingestion unavailable");

  const rows = elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !["node", "way", "relation"].includes(el.type)
      )
        return null;
      const tags = el.tags ?? {};
      const category = matchCategory(tags, missing);
      return {
        id: `osm:${el.type}:${el.id}`,
        osmId: `${el.type}:${el.id}`,
        category,
        name: tags.name ?? tags["name:cs"] ?? null,
        lng,
        lat,
        geog: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`,
        tags,
        cellId: cId
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // A successful empty cell also replaces stale rows. Publish data and freshness together.
  await db.transaction(async (tx) => {
    await tx
      .delete(osmPois)
      .where(and(eq(osmPois.cellId, cId), inArray(osmPois.category, missing)));
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    for (let offset = 0; offset < unique.length; offset += 200) {
      await tx
        .insert(osmPois)
        .values(unique.slice(offset, offset + 200))
        .onConflictDoUpdate({
          target: osmPois.id,
          set: {
            osmId: sql`excluded.osm_id`,
            category: sql`excluded.category`,
            name: sql`excluded.name`,
            lng: sql`excluded.lng`,
            lat: sql`excluded.lat`,
            geog: sql`excluded.geog`,
            tags: sql`excluded.tags`,
            cellId: sql`excluded.cell_id`,
            fetchedAt: sql`now()`
          }
        });
    }
    const cellRows = missing.map((category) => ({
      id: `${cId}:${category}`,
      cellId: cId,
      category
    }));
    await tx
      .insert(osmCells)
      .values(cellRows)
      .onConflictDoUpdate({ target: osmCells.id, set: { fetchedAt: sql`now()` } });
  });
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
export async function fetchOsmElement(
  osmId: string,
  signal?: AbortSignal
): Promise<OsmElement | null> {
  const typed = /^(?:osm[-:])?(node|way|relation)[-:/](\d+)$/.exec(osmId);
  const id = typed?.[2] ?? osmId.replace(/^osm[-:]/, "");
  if (!/^\d+$/.test(id)) return null;
  if (typed) {
    const [cached] = await db
      .select()
      .from(osmPois)
      .where(eq(osmPois.id, `osm:${typed[1]}:${id}`))
      .limit(1);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CELL_TTL_MS) {
      return {
        id: Number(id),
        type: typed[1]!,
        lat: cached.lat,
        lng: cached.lng,
        tags: cached.tags ?? {}
      };
    }
  }
  const selection = typed ? `${typed[1]}(${id});` : `node(${id});way(${id});relation(${id});`;
  const query = `[out:json][timeout:20];(${selection});out center tags 1;`;

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
    }>(query, { timeoutMs: 20_000, signal });
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
  categoriesRaw: string | undefined,
  area?: AreaSelection | null
): Promise<FeatureCollection> {
  const categories = parseCategories(categoriesRaw);
  if (!categories.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const candidates = cellsForBbox(bbox, MAX_CELLS_PER_REQUEST + 1);
  const tooBroad = candidates.length > MAX_CELLS_PER_REQUEST;
  // Never ingest an arbitrary corner of a continent. Broad views use the existing index.
  const cells = tooBroad ? [] : candidates;
  const rowIds = cells.flatMap((cell) =>
    categories.map((category) => `${cellId(cell)}:${category}`)
  );
  const freshness = rowIds.length
    ? await db.select().from(osmCells).where(inArray(osmCells.id, rowIds))
    : [];
  const fresh = new Set(
    freshness
      .filter((row) => Date.now() - row.fetchedAt.getTime() < CELL_TTL_MS)
      .map((row) => row.id)
  );
  const missing = cells.filter((cell) =>
    categories.some((category) => !fresh.has(`${cellId(cell)}:${category}`))
  );
  for (const cell of missing) {
    const wanted = categories
      .filter((category) => !fresh.has(`${cellId(cell)}:${category}`))
      .sort();
    // A cell runs at most once concurrently; the next poll schedules any extra categories.
    osmIngestion.enqueue(cellId(cell), () => ensureCellFetched(cell, wanted));
  }

  const [w, s, e, n] = bbox;
  const rows = await db
    .select({
      id: osmPois.id,
      osmId: osmPois.osmId,
      category: osmPois.category,
      name: osmPois.name,
      lng: osmPois.lng,
      lat: osmPois.lat,
      tags: osmPois.tags,
      wikidata: sql<string | null>`${osmPois.tags}->>'wikidata'`,
      revision: osmPois.fetchedAt
    })
    .from(osmPois)
    .where(
      and(
        areaPredicate(
          area,
          sql`ST_SetSRID(ST_MakePoint(${osmPois.lng},${osmPois.lat}),4326)`,
          true
        ),
        inArray(osmPois.category, categories),
        gte(osmPois.lng, w),
        lte(osmPois.lng, e),
        gte(osmPois.lat, s),
        lte(osmPois.lat, n)
      )
    )
    .orderBy(sql`(${osmPois.name} is not null) desc`)
    .limit(MAX_FEATURES + 1);

  const truncated = rows.length > MAX_FEATURES;
  const features = rows.slice(0, MAX_FEATURES).map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
    properties: {
      id: r.id,
      name: r.name ?? "Bez názvu",
      category: r.category,
      layerId: "osm-poi",
      osmId: r.osmId,
      ...(r.category === "cannabis"
        ? {
            cannabisMedical: r.tags?.["cannabis:medical"] ?? null,
            cannabisRecreational: r.tags?.["cannabis:recreational"] ?? null,
            cannabisCbd: r.tags?.["cannabis:cbd"] ?? null,
            address:
              [r.tags?.["addr:street"], r.tags?.["addr:housenumber"], r.tags?.["addr:city"]]
                .filter(Boolean)
                .join(" ") || null,
            website: r.tags?.website ?? r.tags?.["contact:website"] ?? null,
            phone: r.tags?.phone ?? r.tags?.["contact:phone"] ?? null,
            opening_hours: r.tags?.opening_hours ?? null
          }
        : {}),
      ...(r.wikidata ? { wikidata: r.wikidata } : {}),
      revision: r.revision.toISOString()
    }
  }));

  return {
    type: "FeatureCollection",
    features,
    ...(tooBroad
      ? {
          notice:
            "Přibližte mapu pro načtení dalších bodů. V této oblasti zobrazujeme pouze dříve uložená data."
        }
      : {}),
    query: {
      status: tooBroad || missing.length > 0 || truncated ? "partial" : "complete",
      bbox,
      truncated,
      ...(missing.length ? { retryAfterMs: 5000, cacheTtlMs: 0 } : {}),
      ...(tooBroad ? { cacheTtlMs: 30_000, reason: "zoom-required" as const } : {}),
      fetchedAt: new Date().toISOString()
    }
  };
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
  country?: string,
  area?: AreaSelection | null
): Promise<FeatureCollection> {
  const [w, s, e, n] = bbox;
  const layers = userId
    ? await db.select().from(userLayers).where(eq(userLayers.userId, userId))
    : await db.select().from(userLayers).where(eq(userLayers.isPublic, 1));

  const layerIds = layers.map((l) => l.id);
  if (!layerIds.length) return { type: "FeatureCollection", features: [] };

  const normalizedTag = tag?.trim().toLowerCase();
  const shape = sql`mapos_pin_geometry(${userPins.lng}, ${userPins.lat}, ${userPins.path})`;
  const envelope = sql`ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)`;
  // About one screen pixel: saved/exported geometry is untouched, only the overview is reduced.
  const tolerance = Math.max(e - w, n - s) / 2048;
  const allPins = await db
    .select({
      id: userPins.id,
      layerId: userPins.layerId,
      name: userPins.name,
      lng: userPins.lng,
      lat: userPins.lat,
      tags: userPins.tags,
      kind: userPins.kind,
      country: userPins.country,
      authorName: userPins.authorName,
      properties: userPins.properties,
      description: userPins.description,
      path: sql<unknown>`CASE WHEN ${userPins.path} IS NOT NULL THEN
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(${shape}, ${tolerance}))::jsonb->'coordinates' ELSE NULL END`
    })
    .from(userPins)
    .where(
      and(
        areaPredicate(area, shape),
        inArray(userPins.layerId, layerIds),
        sql`${shape} && ${envelope} AND ST_Intersects(${shape}, ${envelope})`,
        normalizedTag
          ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(${userPins.tags}, '[]'::jsonb)) tag_value
      WHERE lower(tag_value) = ${normalizedTag})`
          : undefined,
        country && country !== "ALL"
          ? sql`(${userPins.country} IS NULL OR ${userPins.country} = ${country})`
          : undefined
      )
    )
    .orderBy(userPins.id)
    .limit(MAX_FEATURES + 1);
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const features = allPins.slice(0, MAX_FEATURES).map((p) => {
    const layer = layerById.get(p.layerId);
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

  return {
    type: "FeatureCollection",
    features,
    query: {
      status: allPins.length > MAX_FEATURES ? "partial" : "complete",
      bbox,
      truncated: allPins.length > MAX_FEATURES
    }
  };
}

export function parseBbox(raw: string | undefined): Bbox {
  if (!raw) throw new ClientError("bbox required");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) throw new ClientError("invalid bbox");
  return parts as Bbox;
}
