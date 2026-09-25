/**
 * The store behind the quest source adapters.
 *
 * Every viewport used to call Opencaching, the OSM notes API, Turf and the Wiki Loves Monuments
 * toolserver directly, which meant dragging the map was a burst of requests to volunteer-run
 * services. None of that data moves quickly — a cache, a note and a Turf zone stay put for hours
 * or years — so the anchors are swept into `quest_anchors` and read back from an index.
 *
 * Two tables, because "no anchors here" is an answer worth remembering. Without the sweep log,
 * an empty area would look identical to an un-fetched one and be re-asked about forever.
 */

import { and, eq, inArray, lt, sql as dsql } from "drizzle-orm";
import type { Bbox, FeatureCollection } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { questAnchorSweeps, questAnchors } from "../db/schema.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import {
  anchoredQuestFeature,
  deriveQuest,
  questSources,
  unavailableSourcesNotice,
  type AnchoredQuest,
  type QuestAnchor,
  type QuestSourceAdapter
} from "./anchors.js";

/**
 * Roughly 28 km of latitude. Sized so a city fits in a handful of cells: much finer and a pan
 * across town would trigger a sweep per block, much coarser and one sweep would pull anchors
 * from a whole region to answer a question about one neighbourhood.
 */
export const ANCHOR_CELL_DEG = 0.25;

/**
 * Past this many cells the viewport is regional, and quests are a walking-distance feature — so
 * a zoomed-out map is served from whatever is already cached and never triggers a sweep. This is
 * what stops a continent-wide view from fanning out into hundreds of upstream requests.
 */
export const MAX_CELLS_PER_SWEEP = 4;

/** Used when an adapter does not state its own. Long enough to be a real cache, short enough
 *  that a newly hidden geocache shows up the same day. */
export const DEFAULT_ANCHOR_REFRESH_MS = 6 * 60 * 60_000;

/** How many anchors to ask a source for per cell. */
const ANCHORS_PER_CELL = 50;

interface Cell {
  key: string;
  bbox: Bbox;
}

/** Cells are identified by their integer grid position, so the same area always produces the
 *  same key no matter which viewport asked about it. */
export function cellsFor(bbox: Bbox): Cell[] {
  const [west, south, east, north] = bbox;
  const minX = Math.floor(west / ANCHOR_CELL_DEG);
  const maxX = Math.floor(east / ANCHOR_CELL_DEG);
  const minY = Math.floor(south / ANCHOR_CELL_DEG);
  const maxY = Math.floor(north / ANCHOR_CELL_DEG);
  const cells: Cell[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      cells.push({
        key: `${x}:${y}`,
        bbox: [
          x * ANCHOR_CELL_DEG,
          y * ANCHOR_CELL_DEG,
          (x + 1) * ANCHOR_CELL_DEG,
          (y + 1) * ANCHOR_CELL_DEG
        ]
      });
      if (cells.length > MAX_CELLS_PER_SWEEP) return cells;
    }
  }
  return cells;
}

function refreshAfterMs(adapter: QuestSourceAdapter): number {
  return adapter.refreshAfterMs ?? DEFAULT_ANCHOR_REFRESH_MS;
}

function anchorRow(anchor: QuestAnchor, sourceId: string, now: Date) {
  return {
    ref: anchor.ref,
    sourceId,
    name: anchor.name,
    category: anchor.category,
    kind: anchor.kind ?? null,
    lng: anchor.lng,
    lat: anchor.lat,
    geog: dsql`ST_SetSRID(ST_MakePoint(${anchor.lng}, ${anchor.lat}), 4326)::geography`,
    weight: anchor.weight ?? null,
    radiusM: anchor.radiusM ?? null,
    description: anchor.description ?? null,
    externalUrl: anchor.externalUrl ?? null,
    refreshedAt: now
  };
}

function anchorFromRow(row: typeof questAnchors.$inferSelect): QuestAnchor {
  return {
    ref: row.ref,
    name: row.name,
    lng: row.lng,
    lat: row.lat,
    category: row.category,
    ...(row.kind ? { kind: row.kind as QuestAnchor["kind"] } : {}),
    ...(row.externalUrl ? { externalUrl: row.externalUrl } : {}),
    ...(row.weight === null ? {} : { weight: row.weight }),
    ...(row.radiusM === null ? {} : { radiusM: row.radiusM }),
    ...(row.description ? { description: row.description } : {})
  };
}

/** Writes one source's view of one cell. Anchors the source no longer returns are removed,
 *  because after a successful sweep the source's answer *is* the truth for that cell — leaving
 *  them would keep offering quests at archived caches and closed notes. */
async function storeSweep(
  adapter: QuestSourceAdapter,
  cell: Cell,
  anchors: QuestAnchor[],
  now: Date
): Promise<void> {
  const [west, south, east, north] = cell.bbox;
  await db.transaction(async (transaction) => {
    if (anchors.length) {
      await transaction
        .insert(questAnchors)
        .values(anchors.map((anchor) => anchorRow(anchor, adapter.id, now)))
        .onConflictDoUpdate({
          target: questAnchors.ref,
          set: {
            name: dsql`excluded.name`,
            category: dsql`excluded.category`,
            kind: dsql`excluded.kind`,
            lng: dsql`excluded.lng`,
            lat: dsql`excluded.lat`,
            geog: dsql`excluded.geog`,
            weight: dsql`excluded.weight`,
            radiusM: dsql`excluded.radius_m`,
            description: dsql`excluded.description`,
            externalUrl: dsql`excluded.external_url`,
            refreshedAt: dsql`excluded.refreshed_at`
          }
        });
    }

    const stale = await transaction
      .select({ ref: questAnchors.ref })
      .from(questAnchors)
      .where(
        and(
          eq(questAnchors.sourceId, adapter.id),
          dsql`${questAnchors.geog} && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography`,
          lt(questAnchors.refreshedAt, now)
        )
      );
    const gone = stale.map((row) => row.ref).filter((ref) => !anchors.some((a) => a.ref === ref));
    if (gone.length) {
      await transaction.delete(questAnchors).where(inArray(questAnchors.ref, gone));
    }

    await transaction
      .insert(questAnchorSweeps)
      .values({
        sourceId: adapter.id,
        cell: cell.key,
        fetchedAt: now,
        anchorCount: anchors.length
      })
      .onConflictDoUpdate({
        target: [questAnchorSweeps.sourceId, questAnchorSweeps.cell],
        set: { fetchedAt: dsql`excluded.fetched_at`, anchorCount: dsql`excluded.anchor_count` }
      });
  });
}

/** Fetches whatever this viewport still needs. Returns the number of sweeps performed, which is
 *  what the tests assert on: the point of the cache is that this reaches zero. */
export async function refreshAnchorsForBbox(
  bbox: Bbox,
  now = new Date(),
  sources?: ReadonlySet<string>
): Promise<number> {
  const cells = cellsFor(bbox);
  if (cells.length > MAX_CELLS_PER_SWEEP) return 0;

  const available = questSources().filter(
    (adapter) => !adapter.unavailableReason?.() && (!sources?.size || sources.has(adapter.id))
  );
  if (!available.length) return 0;

  const swept = await db
    .select()
    .from(questAnchorSweeps)
    .where(
      and(
        inArray(
          questAnchorSweeps.sourceId,
          available.map((adapter) => adapter.id)
        ),
        inArray(
          questAnchorSweeps.cell,
          cells.map((cell) => cell.key)
        )
      )
    );
  const fetchedAt = new Map(swept.map((row) => [`${row.sourceId}/${row.cell}`, row.fetchedAt]));

  const pending = available.flatMap((adapter) =>
    cells
      .filter((cell) => {
        const last = fetchedAt.get(`${adapter.id}/${cell.key}`);
        return !last || now.getTime() - last.getTime() >= refreshAfterMs(adapter);
      })
      .map((cell) => ({ adapter, cell }))
  );

  const outcomes = await Promise.all(
    pending.map(async ({ adapter, cell }) => {
      try {
        const anchors = await adapter.anchors(cell.bbox, ANCHORS_PER_CELL);
        await storeSweep(adapter, cell, anchors, now);
        return true;
      } catch (error) {
        // One dead source must not empty the quest list, and a failed sweep must not be
        // recorded — otherwise an outage would be cached as "this area is empty".
        console.warn("Quest anchor sweep failed", {
          sourceId: adapter.id,
          cell: cell.key,
          ...safeErrorLogFields(error)
        });
        return false;
      }
    })
  );

  return outcomes.filter(Boolean).length;
}

/** Reads cached anchors overlapping the viewport, best first. */
export async function cachedAnchorsForBbox(
  bbox: Bbox,
  limit: number,
  sources?: ReadonlySet<string>
): Promise<Array<{ adapter: QuestSourceAdapter; anchor: QuestAnchor }>> {
  const [west, south, east, north] = bbox;
  const available = questSources().filter(
    (adapter) => !adapter.unavailableReason?.() && (!sources?.size || sources.has(adapter.id))
  );
  if (!available.length) return [];
  const byId = new Map(available.map((adapter) => [adapter.id, adapter]));

  const rows = await db
    .select()
    .from(questAnchors)
    .where(
      and(
        inArray(questAnchors.sourceId, [...byId.keys()]),
        dsql`${questAnchors.geog} && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography`
      )
    )
    // Ordered in the database so the limit keeps the most interesting anchors rather than an
    // arbitrary page of them.
    .orderBy(dsql`COALESCE(${questAnchors.weight}, 1) DESC`, questAnchors.ref)
    .limit(Math.max(1, Math.min(limit, 200)));

  return rows.flatMap((row) => {
    const adapter = byId.get(row.sourceId);
    return adapter ? [{ adapter, anchor: anchorFromRow(row) }] : [];
  });
}

/**
 * Quests for what is in this viewport, from the cache — sweeping first only when the viewport is
 * small enough and something in it has gone stale.
 */
export async function cachedAnchoredQuestsForBbox(
  bbox: Bbox,
  limit = 12
): Promise<AnchoredQuest[]> {
  await refreshAnchorsForBbox(bbox);
  const cached = await cachedAnchorsForBbox(bbox, Math.max(limit * 4, 50));
  return cached
    .map(({ adapter, anchor }) => deriveQuest(adapter, anchor))
    .sort((left, right) => right.rewardPoints - left.rewardPoints)
    .slice(0, limit);
}

/** Renews everything already known that has aged out, independent of anyone looking at it.
 *  Intended for a scheduled call so the common viewports are warm rather than paid for by
 *  whoever happens to open the map first. */
export async function refreshStaleAnchors(
  now = new Date(),
  maxCells = 200
): Promise<{ sweeps: number; cells: number }> {
  const available = questSources().filter((adapter) => !adapter.unavailableReason?.());
  if (!available.length) return { sweeps: 0, cells: 0 };

  const rows = await db.select().from(questAnchorSweeps);
  const stale = rows
    .flatMap((row) => {
      const adapter = available.find((entry) => entry.id === row.sourceId);
      if (!adapter) return [];
      if (now.getTime() - row.fetchedAt.getTime() < refreshAfterMs(adapter)) return [];
      const [x, y] = row.cell.split(":").map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [
        {
          adapter,
          cell: {
            key: row.cell,
            bbox: [
              x! * ANCHOR_CELL_DEG,
              y! * ANCHOR_CELL_DEG,
              (x! + 1) * ANCHOR_CELL_DEG,
              (y! + 1) * ANCHOR_CELL_DEG
            ] as Bbox
          }
        }
      ];
    })
    .slice(0, maxCells);

  let sweeps = 0;
  // Sequential on purpose: this runs unattended, so it must be gentler on the upstreams than a
  // user-facing sweep, which only ever covers a handful of cells.
  for (const { adapter, cell } of stale) {
    try {
      const anchors = await adapter.anchors(cell.bbox, ANCHORS_PER_CELL);
      await storeSweep(adapter, cell, anchors, new Date());
      sweeps += 1;
    } catch (error) {
      console.warn("Scheduled quest anchor refresh failed", {
        sourceId: adapter.id,
        cell: cell.key,
        ...safeErrorLogFields(error)
      });
    }
  }
  return { sweeps, cells: stale.length };
}

/**
 * Quest anchors as map features, for the `game-quests` layer.
 *
 * Each feature carries the derived quest's title and reward alongside the anchor, so the pin
 * detail can say what there is to do here and who the data came from without a second request.
 */
export async function questAnchorFeatures(
  bbox: Bbox,
  sources?: string
): Promise<FeatureCollection> {
  const wanted = new Set(
    (sources ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  await refreshAnchorsForBbox(bbox, new Date(), wanted);
  const cached = await cachedAnchorsForBbox(bbox, 200, wanted);
  const features = cached.map(({ adapter, anchor }) => anchoredQuestFeature(adapter, anchor));
  const notice = features.length ? undefined : unavailableSourcesNotice();
  return { type: "FeatureCollection", features, ...(notice ? { notice } : {}) };
}

/** Hourly, so that whichever windows have aged out get renewed within the hour regardless of
 *  how volatile their source is. The sweep itself decides what is actually stale. */
const ANCHOR_REFRESH_INTERVAL_MS = 60 * 60_000;

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Keeps the already-known areas warm in the background, so the cost of a stale sweep is not
 * paid by whoever happens to open the map first. Only ever renews cells somebody has already
 * looked at — it never goes exploring, which would turn a cache into a crawler.
 */
export function startQuestAnchorRefresher(): void {
  if (refreshTimer) return;
  const run = () =>
    void refreshStaleAnchors().catch((error) =>
      console.warn("Quest anchor refresh failed", safeErrorLogFields(error))
    );
  refreshTimer = setInterval(run, ANCHOR_REFRESH_INTERVAL_MS);
  // Unref'd so the timer never holds the process open on its own.
  refreshTimer.unref?.();
  run();
}

export const __testing = { anchorRow, anchorFromRow, refreshAfterMs };
