/**
 * Serving a theme: which dataset answers for a tile, how the values are classified, and the
 * tile itself.
 *
 * The composite part is the point (§23.5). A tile request names a theme and a period, not a
 * dataset, and the server picks the series that covers the requested resolution. So the client
 * asks the same URL at every zoom and gets country polygons over the Atlantic and NUTS 3
 * regions over Bohemia, without knowing that two different services were involved.
 *
 * Class breaks are computed over the whole series rather than the tile. Quantiles of what
 * happens to be on screen would recolour the map on every pan — the same region changing class
 * because the viewport moved is the classic way a choropleth lies.
 */

import { selectDataset } from "./selectDataset.js";
import { sql as dsql } from "drizzle-orm";
import { statDataset, type StatDatasetDescriptor } from "@mapos/adapter-sdk";
import { higherIsWorse, themeText, type ThemeManifestV2 } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { sourcesForViewport, type ViewportSource } from "./themeCoverage.js";
import { theme, THEMES, themeGroup } from "./themeRegistry.js";

export interface ThemeClassBreak {
  /** Lower bound, inclusive. */
  from: number;
  /** Upper bound, exclusive except in the last class. */
  to: number;
  color: string;
}

export interface ThemeMetadata {
  id: string;
  name: string;
  icon: string;
  unit: string;
  higherIsWorse: boolean;
  disclosure?: string;
  /** Newest first, so a client with no preference lands on the latest data. */
  periods: string[];
  period: string | null;
  breaks: ThemeClassBreak[];
  sources: Array<{
    datasetId: string;
    name: string;
    role: string;
    geoLevel: string;
    attribution: string;
    license: string;
    documentationUrl: string;
    available?: boolean;
  }>;
  /** False until the boundaries and series have been imported; the UI says so rather than
   *  drawing an empty map and looking broken. */
  ready: boolean;
  zoom?: number;
  selectedGeoLevel?: string;
  selectedDatasetId?: string;
  revision?: string;
  observations?: number;
  coverageBbox?: [number, number, number, number] | null;
  group?: string;
}

/**
 * Five classes, colour-blind safe, from ColorBrewer's YlOrRd and YlGnBu.
 *
 * Two ramps rather than one reversed: for "higher is worse" the eye should run cool → hot, and
 * for a neutral count a sequential blue reads as "more" without implying "bad".
 */
const RAMP_BAD = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];
const RAMP_NEUTRAL = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];

export interface ThemeQueries {
  available?: (ids: readonly string[], period?: string) => Promise<string[]>;
  /** Distinct periods present for a set of datasets, ascending. */
  periods: (datasetIds: readonly string[]) => Promise<string[]>;
  /** Quantile boundaries over one dataset and period: four cuts for five classes. */
  quantiles: (datasetId: string, period: string) => Promise<number[]>;
  tile: (request: ThemeTileRequest) => Promise<Uint8Array | null>;
  /** Whether any boundary at all has been imported. */
  hasGeoUnits: () => Promise<boolean>;
  /** Sources covering an extent, most of it first; drives the Sources popover (§23.3). */
  coverage: (
    themeId: string,
    bbox: readonly [number, number, number, number]
  ) => Promise<ViewportSource[]>;
  /** Every period a territory has a value for, plus its standing in the newest one. */
  unit: (request: {
    datasetId: string;
    geoLevel: string;
    geoCode: string;
    period: string;
  }) => Promise<ThemeUnitFacts | null>;
}

export interface ThemeUnitFacts {
  name: string;
  period?: string;
  flag?: string;
  value: number | null;
  /** 1 is the highest value in the period, so "3rd of 14" reads as "third highest". */
  rank: number | null;
  of: number;
  /** Ascending by period: the sparkline's x axis. */
  series: Array<{ period: string; value: number | null; flag?: string }>;
}

export interface ThemeTileRequest {
  datasetId: string;
  geoLevel: string;
  period: string;
  z: number;
  x: number;
  y: number;
}

export async function themeMetadata(
  id: string,
  requestedPeriod: string | undefined,
  queries: ThemeQueries = databaseQueries,
  excluded: readonly string[] = [],
  locale = "en",
  zoom?: number
): Promise<ThemeMetadata | null> {
  const descriptor = theme(id);
  if (!descriptor) return null;
  const text = themeText(descriptor, locale);

  // Switching a source off has to change the classification too. Keeping the breaks from a
  // source that is no longer drawn would leave the legend describing colours the map stopped
  // using.
  let published = datasetsOf(descriptor);
  if (queries.available) {
    const available = await queries.available(
      published.map((e) => e.dataset.id),
      requestedPeriod
    );
    published = published.filter((e) => available.includes(e.dataset.id));
  }
  const datasets = published.filter((entry) => !excluded.includes(entry.dataset.id));
  const primary = selectDataset(datasets, (entry) => entry.dataset, zoom);
  const periods = (await queries.periods(primary ? [primary.dataset.id] : [])).reverse();
  const period =
    requestedPeriod === "latest"
      ? periods.length
        ? "latest"
        : null
      : requestedPeriod
        ? periods.includes(requestedPeriod)
          ? requestedPeriod
          : null
        : (periods[0] ?? null);

  const cuts = period && primary ? await queries.quantiles(primary.dataset.id, "all") : [];
  return {
    id: descriptor.id,
    zoom,
    selectedGeoLevel: primary?.dataset.geoLevel,
    selectedDatasetId: primary?.dataset.id,
    group: themeGroup(descriptor.id),
    name: text.name,
    icon: descriptor.icon ?? "bar_chart",
    unit: text.unit,
    higherIsWorse: higherIsWorse(descriptor),
    ...(text.disclosure ? { disclosure: text.disclosure } : {}),
    periods,
    period,
    breaks: classBreaks(cuts, higherIsWorse(descriptor)),
    sources: datasetsOf(descriptor).map((entry) => ({
      available: published.some((candidate) => candidate.dataset.id === entry.dataset.id),
      datasetId: entry.dataset.id,
      name: entry.dataset.name,
      role: entry.role,
      geoLevel: entry.dataset.geoLevel,
      attribution: entry.dataset.attribution,
      license: entry.dataset.license,
      documentationUrl: entry.dataset.documentationUrl
    })),
    ready: period !== null && periods.length > 0 && (await queries.hasGeoUnits())
  };
}

export function listThemes(): ThemeManifestV2[] {
  return [...THEMES];
}

/** Turns four quantile cuts into five labelled, coloured classes. */
export function classBreaks(cuts: readonly number[], higherIsWorse: boolean): ThemeClassBreak[] {
  const ramp = higherIsWorse ? RAMP_BAD : RAMP_NEUTRAL;
  const finite = cuts.filter((cut) => Number.isFinite(cut));
  if (finite.length < 2) return [];
  // A series where several quantiles coincide — common for counts with many zeroes — would
  // otherwise produce empty classes that appear in the legend and never on the map.
  const bounds = [...new Set(finite)].sort((a, b) => a - b);
  if (bounds.length === 1) return [{ from: bounds[0]!, to: bounds[0]!, color: ramp[2]! }];
  const breaks: ThemeClassBreak[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    breaks.push({
      from: bounds[index]!,
      to: bounds[index + 1]!,
      color: ramp[Math.min(index, ramp.length - 1)]!
    });
  }
  return breaks;
}

export async function themeTile(
  id: string,
  z: number,
  x: number,
  y: number,
  requestedPeriod: string | undefined,
  queries: ThemeQueries = databaseQueries,
  excluded: readonly string[] = [],
  resolutionZoom?: number
): Promise<Uint8Array | null> {
  const descriptor = theme(id);
  if (!descriptor) return null;
  let datasets = datasetsOf(descriptor).filter((entry) => !excluded.includes(entry.dataset.id));
  if (queries.available) {
    const available = await queries.available(
      datasets.map((e) => e.dataset.id),
      requestedPeriod
    );
    datasets = datasets.filter((e) => available.includes(e.dataset.id));
  }
  const zoom = resolutionZoom ?? z;
  const preferred = selectDataset(datasets, (entry) => entry.dataset, zoom);
  if (!preferred) return null;
  let chosen = preferred;
  let period: string | undefined;
  for (const candidate of [preferred, ...datasets.filter((e) => e !== preferred)]) {
    const periods = await queries.periods([candidate.dataset.id]);
    period =
      requestedPeriod === "latest"
        ? periods.length
          ? "latest"
          : undefined
        : requestedPeriod
          ? periods.includes(requestedPeriod)
            ? requestedPeriod
            : undefined
          : periods.at(-1);
    if (period) {
      chosen = candidate;
      break;
    }
  }
  if (!period) return null;

  return queries.tile({
    datasetId: chosen.dataset.id,
    geoLevel: chosen.dataset.geoLevel,
    period,
    z,
    x,
    y
  });
}

export interface ThemeViewportSource {
  datasetId: string;
  name: string;
  role: string;
  geoLevel: string;
  attribution: string;
  license: string;
  documentationUrl: string;
  /** 0–1 of the requested extent, or null where nothing has been imported for the source. */
  share: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  units: number;
}

/**
 * The Sources popover for one extent.
 *
 * Sources with no coverage are kept rather than filtered out, and sorted last. A user who zooms
 * to Portugal and sees the Czech register listed as "covers nothing here" learns something; a
 * list that silently shortens just looks like sources come and go.
 */
export async function themeSources(
  id: string,
  bbox: readonly [number, number, number, number],
  queries: ThemeQueries = databaseQueries
): Promise<ThemeViewportSource[]> {
  const descriptor = theme(id);
  if (!descriptor) return [];
  const covering = new Map((await queries.coverage(id, bbox)).map((row) => [row.sourceId, row]));

  return datasetsOf(descriptor)
    .map((entry) => {
      const cover = covering.get(entry.dataset.id);
      return {
        datasetId: entry.dataset.id,
        name: entry.dataset.name,
        role: entry.role,
        geoLevel: entry.dataset.geoLevel,
        attribution: entry.dataset.attribution,
        license: entry.dataset.license,
        documentationUrl: entry.dataset.documentationUrl,
        share: cover ? cover.share : null,
        periodFrom: cover?.periodFrom ?? null,
        periodTo: cover?.periodTo ?? null,
        units: cover?.units ?? 0
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
}

/**
 * A series drawn on its own, without a theme in front of it.
 *
 * A user's imported table is exactly this: numbers per territory with no editorial framing, no
 * second source to fall back to and no disclosure to attach. Sharing the classification and the
 * tile query with themes is deliberate — a spreadsheet should be classified the same way
 * Eurostat data is, or the two cannot be read side by side.
 */
export async function datasetMetadata(
  datasetId: string,
  geoLevel: string,
  period: string,
  queries: ThemeQueries = databaseQueries
): Promise<{
  periods: string[];
  period: string | null;
  breaks: ThemeClassBreak[];
  ready: boolean;
  zoom?: number;
  selectedGeoLevel?: string;
  selectedDatasetId?: string;
}> {
  const periods = (await queries.periods([datasetId])).reverse();
  const chosen = periods.includes(period) ? period : (periods[0] ?? null);
  const cuts = chosen ? await queries.quantiles(datasetId, chosen) : [];
  return {
    periods,
    period: chosen,
    // Neutral ramp: nobody but the uploader knows whether more is better, and colouring their
    // numbers red would be the map taking a position it has no basis for.
    breaks: classBreaks(cuts, false),
    ready: periods.length > 0 && (await queries.hasGeoUnits())
  };
}

export async function datasetTile(
  request: ThemeTileRequest,
  queries: ThemeQueries = databaseQueries
): Promise<Uint8Array | null> {
  return queries.tile(request);
}

export interface ThemeUnitDetail extends ThemeUnitFacts {
  themeId: string;
  code: string;
  geoLevel: string;
  unit: string;
  period: string;
  flag?: string;
  source: { datasetId: string; name: string; attribution: string };
}

/**
 * What a click on a territory should say.
 *
 * The rank is as much of the answer as the value: "690 offences per 100 000" means nothing to
 * most readers, and "3rd highest of the 14 regions in this series" means something to everyone.
 * The series behind it is what turns a single year into a direction of travel.
 */
export async function themeUnit(
  id: string,
  geoLevel: string,
  geoCode: string,
  requestedPeriod: string | undefined,
  queries: ThemeQueries = databaseQueries,
  excluded: readonly string[] = [],
  locale = "en"
): Promise<ThemeUnitDetail | null> {
  const descriptor = theme(id);
  if (!descriptor) return null;
  const datasets = datasetsOf(descriptor).filter((entry) => !excluded.includes(entry.dataset.id));
  // The territory's own level decides the source, the same way the tile's zoom does. Answering
  // a NUTS 3 click from a country series would report a number the user cannot see on the map.
  const chosen =
    datasets.find((entry) => entry.dataset.geoLevel === geoLevel) ??
    datasets.find((entry) => entry.role === "primary");
  if (!chosen) return null;

  const periods = await queries.periods([chosen.dataset.id]);
  const period =
    requestedPeriod === "latest"
      ? "latest"
      : requestedPeriod
        ? periods.includes(requestedPeriod)
          ? requestedPeriod
          : undefined
        : periods[periods.length - 1];
  if (!period) return null;

  const facts = await queries.unit({
    datasetId: chosen.dataset.id,
    geoLevel,
    geoCode,
    period
  });
  if (!facts) return null;

  return {
    ...facts,
    themeId: descriptor.id,
    code: geoCode,
    geoLevel,
    unit: themeText(descriptor, locale).unit,
    period: facts.period ?? period,
    source: {
      datasetId: chosen.dataset.id,
      name: chosen.dataset.name,
      attribution: chosen.dataset.attribution
    }
  };
}

function datasetsOf(
  descriptor: ThemeManifestV2
): Array<{ dataset: StatDatasetDescriptor; role: string }> {
  return descriptor.sources.flatMap((source) => {
    const dataset = statDataset(source.datasetId);
    return dataset ? [{ dataset, role: source.role }] : [];
  });
}

const tileCache = new Map<string, Uint8Array>();
let tileCacheBytes = 0;

const availabilityCache = new Map<string, { until: number; ids: string[] }>();
export const databaseQueries: ThemeQueries = {
  async available(ids, period = "latest") {
    const key = JSON.stringify([ids, period, process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA]);
    const cached = availabilityCache.get(key);
    if (cached && cached.until > Date.now()) return cached.ids;
    const rows = await db.execute(dsql`SELECT DISTINCT s.dataset_id FROM stat_series s
      JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code
      WHERE s.dataset_id=ANY(${dsql.raw(arrayLiteral(ids))}) AND s.value IS NOT NULL
      AND (${period}='latest' OR s.period=${period})
      AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
      AND (${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"} OR g.source_id='natural-earth' OR (g.source_id='gisco-nuts' AND g.edition='2024' AND g.level IN ('nuts1','nuts2','nuts3'))
        OR (g.level='lau' AND g.edition LIKE '2024:%' AND g.source_id LIKE 'gisco-lau-%'))`);
    const result = rowsOf<{ dataset_id: string }>(rows).map((r) => r.dataset_id);
    if (availabilityCache.size >= 128)
      availabilityCache.delete(availabilityCache.keys().next().value!);
    availabilityCache.set(key, { until: Date.now() + 60000, ids: result });
    return result;
  },
  async periods(datasetIds) {
    if (!datasetIds.length) return [];
    const rows = await db.execute(dsql`
      SELECT DISTINCT period FROM stat_series
      WHERE dataset_id = ANY(${dsql.raw(arrayLiteral(datasetIds))})
      ORDER BY period
    `);
    return rowsOf<{ period: string }>(rows).map((row) => row.period);
  },

  async quantiles(datasetId, period) {
    const rows = await db.execute(dsql`
      SELECT ARRAY[
        MIN(value),
        percentile_cont(0.2) WITHIN GROUP (ORDER BY value),
        percentile_cont(0.4) WITHIN GROUP (ORDER BY value),
        percentile_cont(0.6) WITHIN GROUP (ORDER BY value),
        percentile_cont(0.8) WITHIN GROUP (ORDER BY value),
        MAX(value)
      ] AS cuts
      FROM stat_series
      WHERE dataset_id = ${datasetId} AND (${period} = 'all' OR period = ${period}) AND value IS NOT NULL
    `);
    const cuts = rowsOf<{ cuts: number[] }>(rows)[0]?.cuts ?? [];
    return cuts
      .filter((value) => value !== null)
      .map(Number)
      .filter((value) => Number.isFinite(value));
  },

  async tile({ datasetId, geoLevel, period, z, x, y }) {
    const publication = rowsOf<{ revision: string; boundary_revision: string }>(
      await db.execute(dsql`
      SELECT revision,(SELECT MAX(imported_at)::text FROM geo_units WHERE level=${geoLevel}) AS boundary_revision
      FROM stat_import_runs WHERE dataset_id=${datasetId}`)
    )[0];
    const cacheKey = publication?.revision
      ? JSON.stringify([
          datasetId,
          geoLevel,
          period,
          z,
          x,
          y,
          publication.revision,
          publication.boundary_revision
        ])
      : null;
    if (cacheKey && tileCache.has(cacheKey)) return tileCache.get(cacheKey)!;

    // `ST_AsMVTGeom` with `clip_geom` does the clipping, and the 64-unit buffer is what stops a
    // polygon's outline from being cut off at the tile seam.
    const rows = await db.execute(dsql`
      WITH bounds AS (SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS envelope)
      SELECT ST_AsMVT(source, 'units', 4096, 'geom') AS tile
      FROM (
        SELECT
          g.code,
          g.name,
          g.level,
          s.value,
          s.flag,
          s.period,
          s.dataset_id AS "datasetId",
          ST_AsMVTGeom(
            ST_Transform(g.geom, 3857),
            bounds.envelope,
            4096,
            64,
            true
          ) AS geom
        FROM geo_units g
        CROSS JOIN bounds
        LEFT JOIN LATERAL (
          SELECT * FROM stat_series ss WHERE ss.geo_level=g.level AND ss.geo_code=g.code
            AND ss.dataset_id=${datasetId} AND ((${period}='latest' AND ss.value IS NOT NULL) OR ss.period=${period})
            AND (ss.boundary_edition IS NULL OR ss.boundary_edition=g.edition)
          ORDER BY ss.period DESC LIMIT 1
        ) s ON true
        WHERE g.level = ${geoLevel}
          AND (${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"} OR g.source_id='natural-earth' OR (g.source_id='gisco-nuts' AND g.edition='2024' AND g.level IN ('nuts1','nuts2','nuts3'))
            OR (g.level='lau' AND g.edition LIKE '2024:%' AND g.source_id LIKE 'gisco-lau-%'))
          AND g.geom && ST_Transform(bounds.envelope, 4326)
          AND ST_Intersects(g.geom, ST_Transform(bounds.envelope, 4326))
      ) AS source
      WHERE source.geom IS NOT NULL
    `);
    const tile = rowsOf<{ tile: Buffer | null }>(rows)[0]?.tile;
    const result = tile ? new Uint8Array(tile) : null;
    if (cacheKey && result) {
      while (
        tileCache.size &&
        (tileCache.size >= 128 || tileCacheBytes + result.byteLength > 16 * 1024 * 1024)
      ) {
        const oldest = tileCache.keys().next().value!;
        tileCacheBytes -= tileCache.get(oldest)!.byteLength;
        tileCache.delete(oldest);
      }
      if (result.byteLength <= 16 * 1024 * 1024) {
        tileCache.set(cacheKey, result);
        tileCacheBytes += result.byteLength;
      }
    }
    return result;
  },

  async coverage(themeId, bbox) {
    return sourcesForViewport(themeId, bbox);
  },

  async unit({ datasetId, geoLevel, geoCode, period }) {
    const rows = await db.execute(dsql`
      WITH selected AS (
        SELECT DISTINCT ON (geo_code) * FROM stat_series
        WHERE dataset_id=${datasetId} AND geo_level=${geoLevel} AND ((${period}='latest' AND value IS NOT NULL) OR period=${period})
        ORDER BY geo_code,period DESC
      ), ranked AS (
        SELECT
          geo_code,
          period,
          flag,
          value,
          RANK() OVER (ORDER BY value DESC NULLS LAST) AS rank,
          COUNT(*) FILTER (WHERE value IS NOT NULL) OVER () AS total
        FROM selected
      )
      SELECT
        COALESCE(g.name,${geoCode}) AS name,
        r.value,
        r.period,
        r.flag,
        r.rank,
        r.total,
        COALESCE(
          (
            SELECT json_agg(json_build_object('period', s.period, 'value', s.value, 'flag',s.flag)
                            ORDER BY s.period)
            FROM stat_series s
            WHERE s.dataset_id = ${datasetId}
              AND s.geo_level = ${geoLevel}
              AND s.geo_code = ${geoCode}
          ),
          '[]'::json
        ) AS series
      FROM (SELECT ${geoCode}::text AS code) requested
      LEFT JOIN geo_units g ON g.level=${geoLevel} AND g.code=requested.code
      LEFT JOIN ranked r ON r.geo_code = requested.code
      WHERE EXISTS(SELECT 1 FROM stat_series WHERE dataset_id=${datasetId} AND geo_level=${geoLevel} AND geo_code=${geoCode})
    `);
    const row = rowsOf<{
      name: string;
      period?: string;
      flag?: string;
      value: number | null;
      rank: number | null;
      total: number | null;
      series: Array<{ period: string; value: number | null; flag?: string }> | null;
    }>(rows)[0];
    if (!row) return null;
    return {
      name: row.name,
      period: row.period,
      flag: row.flag,
      value: row.value === null ? null : Number(row.value),
      // A territory with no value has no standing, and reporting it as last would be a claim the
      // data does not make.
      rank: row.value === null || row.rank === null ? null : Number(row.rank),
      of: Number(row.total ?? 0),
      series: (row.series ?? []).map((entry) => ({
        period: entry.period,
        flag: entry.flag,
        value: entry.value === null ? null : Number(entry.value)
      }))
    };
  },

  async hasGeoUnits() {
    const rows = await db.execute(dsql`
      SELECT EXISTS (SELECT 1 FROM geo_units) AS present
    `);
    return rowsOf<{ present: boolean }>(rows)[0]?.present === true;
  }
};

/** `ANY` needs a literal array, and the ids come from the registry rather than from a request,
 *  so they are quoted defensively but never user-supplied. */
function arrayLiteral(values: readonly string[]): string {
  const quoted = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(",");
  return `ARRAY[${quoted}]::text[]`;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
