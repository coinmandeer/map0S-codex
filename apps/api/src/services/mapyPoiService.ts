/** Keyword-matrix POI engine — how we get bbox POI results out of an API that has no bbox POI
 *  endpoint.
 *
 *  api.mapy.com exposes `/v1/suggest`, a name search that accepts `locality=BOX(w,s,e,n)` as a
 *  *hard* filter. That single property is enough to turn a name search into an area scan: split
 *  the viewport into cells, and for each cell ask for the words places of a given kind are
 *  actually named in that country's language (see data/mapyKeywords.ts).
 *
 *  Cost control, because this fans out fast:
 *  - cells × categories × keywords × languages is capped by MAX_PROBES per request;
 *  - every probe result is cached for a week keyed on all four dimensions, so panning back
 *    over an area is free;
 *  - concurrency is limited well under Mapy's 100 req/s so one user can't exhaust the quota.
 *
 *  What this is *not*: a replacement for Overpass. Name search finds named landmarks brilliantly
 *  and unnamed amenities not at all. Fusion (poiFusionService) is what makes the pair useful.
 */

import type { Bbox, OsmPoiCategoryId } from "@mapos/layer-sdk";
import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { mapyCells, mapyPois } from "../db/schema.js";
import { isoForBbox, langsForBbox, type MapyLang } from "../data/euCountries.js";
import { isMapySearchable, keywordsFor, labelMatchesCategory } from "../data/mapyKeywords.js";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";
import { config } from "../config.js";
import { mapySuggest, MapyNotConfiguredError } from "./mapyService.js";

const CELL_TTL_MS = 7 * 24 * 3600_000;
/** z11 ≈ 20 km across in Central Europe — small enough that a 15-result suggest limit rarely
 *  truncates, large enough that a city viewport is a handful of cells, not hundreds. */
const CELL_ZOOM = 11;
const MAX_CELLS = 12;
/** Hard ceiling on upstream calls for one viewport request. Anything past this is dropped and
 *  reported as `truncated` — the next pan picks up where this left off via the cache. */
const MAX_PROBES = 90;
const CONCURRENCY = 8;
const MAX_RESULTS = 2000;

export interface MapyPoiResult {
  places: {
    id: string;
    name: string;
    category: string;
    lng: number;
    lat: number;
    label: string | null;
    location: string | null;
  }[];
  meta: {
    probes: number;
    cached: number;
    truncated: boolean;
    langs: MapyLang[];
  };
}

interface Probe {
  cell: Cell;
  category: OsmPoiCategoryId;
  keyword: string;
  lang: MapyLang;
}

function probeId(p: Probe): string {
  return `${cellId(p.cell)}:${p.category}:${p.lang}:${p.keyword}`;
}

/** Fold accents and case so "Zřícenina Okoř" and "zricenina okor" dedupe to the same key. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      try {
        await fn(item);
      } catch (err) {
        console.warn("Mapy probe failed:", err);
      }
    }
  });
  await Promise.all(workers);
}

/** Every (cell, category, keyword, lang) combination the viewport implies, before cache. */
function planProbes(
  bbox: Bbox,
  categories: OsmPoiCategoryId[]
): { probes: Probe[]; langs: MapyLang[]; iso: string | undefined } {
  const cells = cellsForBbox(bbox, MAX_CELLS, CELL_ZOOM);
  const langs = langsForBbox(bbox);
  const iso = isoForBbox(bbox);
  const probes: Probe[] = [];

  for (const cell of cells) {
    for (const category of categories) {
      if (!isMapySearchable(category)) continue;
      for (const lang of langs) {
        for (const keyword of keywordsFor(category, lang, iso)) {
          probes.push({ cell, category, keyword, lang });
        }
      }
    }
  }
  return { probes, langs, iso };
}

async function runProbe(probe: Probe, iso: string | undefined): Promise<void> {
  const bbox = cellBounds(probe.cell);
  const items = await mapySuggest({
    query: probe.keyword,
    lang: probe.lang,
    bbox,
    limit: 15,
    type: "poi"
  });

  const rows = items
    .filter((item) => item.name)
    // Mapy emits unnamed placeholder entries whose name is just the category label
    // ("Festung, Bunker :: Festung, Bunker"). They carry no information worth a pin.
    .filter((item) => item.name !== item.label)
    // Suggest ranks fuzzily: a "hrad" query returns "Autodoprava Hradecký" alongside "Pražský
    // hrad". Mapy's own category label ("Nákladní doprava" vs "Hrad") separates them cleanly,
    // which matters far more than recall here — a wrong pin on the map is worse than a missing
    // one, since Overpass covers the same area anyway.
    .filter((item) => labelMatchesCategory(item.label, probe.category, probe.lang, iso))
    .map((item) => ({
      id: `mapy-${probe.category}-${item.position.lon.toFixed(5)}-${item.position.lat.toFixed(5)}`,
      category: probe.category,
      name: item.name,
      label: item.label || null,
      location: item.location || null,
      poiType: item.type || null,
      lng: item.position.lon,
      lat: item.position.lat,
      cellId: cellId(probe.cell)
    }));

  if (rows.length) {
    // Coordinate-derived ids make the same place from two keywords collapse naturally, but two
    // probes racing on the same place would still conflict — delete-then-insert keeps it simple.
    const ids = [...new Set(rows.map((r) => r.id))];
    const unique = ids.map((id) => rows.find((r) => r.id === id)!);
    await db.delete(mapyPois).where(inArray(mapyPois.id, ids));
    await db.insert(mapyPois).values(unique);
  }

  await db.insert(mapyCells).values({
    id: probeId(probe),
    cellId: cellId(probe.cell),
    category: probe.category,
    keyword: probe.keyword,
    lang: probe.lang
  });
}

export async function getMapyPois(
  bbox: Bbox,
  categories: OsmPoiCategoryId[]
): Promise<MapyPoiResult> {
  if (!config.mapyKey) throw new MapyNotConfiguredError();

  const { probes, langs, iso } = planProbes(bbox, categories);
  const empty = { probes: 0, cached: 0, truncated: false, langs };
  if (!probes.length) return { places: [], meta: empty };

  const ids = probes.map(probeId);
  const known = await db.select().from(mapyCells).where(inArray(mapyCells.id, ids));
  const fresh = new Set(
    known.filter((r) => Date.now() - r.fetchedAt.getTime() < CELL_TTL_MS).map((r) => r.id)
  );
  const stale = known.filter((r) => !fresh.has(r.id)).map((r) => r.id);
  if (stale.length) await db.delete(mapyCells).where(inArray(mapyCells.id, stale));

  const pending = probes.filter((p) => !fresh.has(probeId(p)));
  const truncated = pending.length > MAX_PROBES;
  const toRun = pending.slice(0, MAX_PROBES);

  await runWithConcurrency(toRun, CONCURRENCY, (probe) => runProbe(probe, iso));

  const [w, s, e, n] = bbox;
  const rows = await db
    .select()
    .from(mapyPois)
    .where(
      and(
        inArray(mapyPois.category, categories),
        gte(mapyPois.lng, w),
        lte(mapyPois.lng, e),
        gte(mapyPois.lat, s),
        lte(mapyPois.lat, n)
      )
    )
    .limit(MAX_RESULTS);

  return {
    places: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      lng: r.lng,
      lat: r.lat,
      label: r.label,
      location: r.location
    })),
    meta: { probes: toRun.length, cached: fresh.size, truncated, langs }
  };
}

export const __testing = { normalizeName, planProbes, probeId };
