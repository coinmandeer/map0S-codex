/**
 * Which source answers where, and how much of a viewport each one covers.
 *
 * Two jobs, both of them §23.2's. Recording coverage turns an import into a statement about
 * territories rather than a pile of rows: after importing Eurostat's crime series we know the
 * 1 100 NUTS 3 codes it contained and the years it contained them for. Reading coverage back
 * for a viewport is what lets the sources popover be ordered by relevance — "Eurostat NUTS3 ·
 * 2023 · covers 92 % of the view" — instead of by an arbitrary registry order.
 *
 * The share is computed by summing intersections rather than unioning geometries first. Within
 * one source the territories do not overlap, so the sum is exact, and it costs one pass over an
 * index instead of building a union of a thousand polygons per request.
 */

import { sql as dsql } from "drizzle-orm";
import type { StatObservation } from "@mapos/adapter-sdk";
import { db } from "../db/index.js";

export interface CoverageRow {
  themeId: string;
  sourceId: string;
  geoLevel: string;
  geoCode: string;
  periodFrom: string;
  periodTo: string;
  observations: number;
  quality: number;
}

export interface ViewportSource {
  sourceId: string;
  geoLevel: string;
  periodFrom: string | null;
  periodTo: string | null;
  /** 0–1 share of the requested extent this source has territories for. */
  share: number;
  /** How many of its territories are in the extent, for "covers 3 regions" style copy. */
  units: number;
}

/**
 * Turns imported observations into coverage rows.
 *
 * Only observations with a value count towards `observations`: a series that lists a territory
 * and then reports nothing for it every year covers that territory on paper only, and ordering
 * sources by paper coverage puts the least useful one first.
 */
export function coverageFromObservations(
  themeId: string,
  sourceId: string,
  geoLevel: string,
  observations: readonly StatObservation[],
  quality = 1
): CoverageRow[] {
  const byCode = new Map<string, { periods: string[]; withValue: number }>();
  for (const observation of observations) {
    const entry = byCode.get(observation.geoCode) ?? { periods: [], withValue: 0 };
    entry.periods.push(observation.period);
    if (observation.value !== null && observation.value !== undefined) entry.withValue += 1;
    byCode.set(observation.geoCode, entry);
  }

  const rows: CoverageRow[] = [];
  for (const [geoCode, entry] of byCode) {
    if (!entry.withValue) continue;
    const sorted = [...entry.periods].sort();
    rows.push({
      themeId,
      sourceId,
      geoLevel,
      geoCode,
      periodFrom: sorted[0]!,
      periodTo: sorted[sorted.length - 1]!,
      observations: entry.withValue,
      quality
    });
  }
  return rows;
}

export async function persistCoverage(rows: readonly CoverageRow[]): Promise<void> {
  for (const row of rows) {
    await db.execute(dsql`
      INSERT INTO theme_coverage
        (theme_id, source_id, geo_level, geo_code, period_from, period_to, observations,
         quality, refreshed_at)
      VALUES (
        ${row.themeId}, ${row.sourceId}, ${row.geoLevel}, ${row.geoCode},
        ${row.periodFrom}, ${row.periodTo}, ${row.observations}, ${row.quality}, now()
      )
      ON CONFLICT (theme_id, source_id, geo_level, geo_code) DO UPDATE SET
        period_from = EXCLUDED.period_from,
        period_to = EXCLUDED.period_to,
        observations = EXCLUDED.observations,
        quality = EXCLUDED.quality,
        refreshed_at = now()
    `);
  }
}

/** Sources for a theme, ordered by how much of `bbox` they can answer for. */
export async function sourcesForViewport(
  themeId: string,
  bbox: readonly [number, number, number, number]
): Promise<ViewportSource[]> {
  const [west, south, east, north] = bbox;
  const rows = await db.execute(dsql`
    WITH extent AS (
      SELECT ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326) AS geom
    )
    SELECT
      c.source_id AS "sourceId",
      c.geo_level AS "geoLevel",
      MIN(c.period_from) AS "periodFrom",
      MAX(c.period_to) AS "periodTo",
      COUNT(*)::int AS units,
      COALESCE(
        SUM(ST_Area(ST_Intersection(g.geom, extent.geom))) / NULLIF(ST_Area(extent.geom), 0),
        0
      ) AS share
    FROM theme_coverage c
    JOIN geo_units g ON g.level = c.geo_level AND g.code = c.geo_code
    CROSS JOIN extent
    WHERE c.theme_id = ${themeId} AND ST_Intersects(g.geom, extent.geom)
    GROUP BY c.source_id, c.geo_level
    ORDER BY share DESC, units DESC
  `);

  return rowsOf<{
    sourceId: string;
    geoLevel: string;
    periodFrom: string | null;
    periodTo: string | null;
    units: number;
    share: string | number;
  }>(rows).map((row) => ({
    sourceId: row.sourceId,
    geoLevel: row.geoLevel,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    units: Number(row.units),
    // A viewport crossing the antimeridian or extending past the poles can push the ratio over
    // one; clamping keeps "covers 104 % of the view" out of the interface.
    share: Math.min(1, Math.max(0, Number(row.share)))
  }));
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
