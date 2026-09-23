/**
 * Import statistical series on the server, independently of map movement. One descriptor
 * fixes a measure and its dimensions; parsing validates identity before an atomic publication
 * replaces that dataset's observations, coverage and receipt. Geography aliases are explicit
 * in the adapter, and regional editions must match the selected boundary release.
 */

import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import {
  parseStatDataset,
  STAT_DATASETS,
  type StatDatasetDescriptor,
  type StatObservation
} from "@mapos/adapter-sdk";
import { db, sql } from "../db/index.js";
import { fetchJson } from "../utils/upstream.js";
import { coverageFromObservations, persistCoverage } from "./themeCoverage.js";
import { THEMES } from "./themeRegistry.js";

export interface StatImportResult {
  datasetId: string;
  observations: number;
  written: number;
  periods: string[];
  /** Territory rows written to `theme_coverage`, summed over every theme using the dataset. */
  covered: number;
  error?: string;
}

export interface StatImportDeps {
  fetchDataset: (dataset: StatDatasetDescriptor) => Promise<unknown>;
  persist: (dataset: StatDatasetDescriptor, rows: readonly StatObservation[]) => Promise<void>;
  describe?: (dataset: StatDatasetDescriptor, periods: readonly string[]) => Promise<void>;
  publish?: (
    dataset: StatDatasetDescriptor,
    rows: readonly StatObservation[],
    periods: readonly string[]
  ) => Promise<void>;
  cover?: (dataset: StatDatasetDescriptor, rows: readonly StatObservation[]) => Promise<number>;
}

const BATCH = 500;

export async function importStatDataset(
  dataset: StatDatasetDescriptor,
  deps: StatImportDeps
): Promise<StatImportResult> {
  const parsed = parseStatDataset(dataset, await deps.fetchDataset(dataset));
  // An observation with no value is still worth storing: "measured, and there is no number" is
  // a different colour from "never measured", and only the stored row can tell them apart.
  const rows = parsed.observations;
  if (deps.publish) {
    if (!rows.some((row) => row.value !== null))
      throw new Error("Dataset contains no measured values");
    await deps.publish(dataset, rows, parsed.periods);
    return {
      datasetId: dataset.id,
      observations: rows.length,
      written: rows.length,
      periods: parsed.periods,
      covered: 0
    };
  }
  let written = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    await deps.persist(dataset, batch);
    written += batch.length;
  }
  await deps.describe?.(dataset, parsed.periods);
  // Coverage is derived from what arrived, not from what the catalogue claims: a series that
  // says it is European and turns out to hold four countries should order fourth in the sources
  // popover, and only the parsed rows know that.
  const covered = (await deps.cover?.(dataset, rows)) ?? 0;
  return {
    datasetId: dataset.id,
    observations: rows.length,
    written,
    periods: parsed.periods,
    covered
  };
}

/** Records the dataset's territories against every theme that lists it as a source. */
export async function recordDatasetCoverage(
  dataset: StatDatasetDescriptor,
  rows: readonly StatObservation[]
): Promise<number> {
  let written = 0;
  for (const entry of THEMES) {
    const source = entry.sources.find((candidate) => candidate.datasetId === dataset.id);
    if (!source) continue;
    // A detail source is trusted a shade less than a primary one: it reaches the theme through
    // a mapping, so where both cover a territory the primary should win the tie.
    const quality = source.role === "primary" ? 1 : 0.8;
    const coverage = coverageFromObservations(
      entry.id,
      dataset.id,
      dataset.geoLevel,
      rows,
      quality
    );
    await persistCoverage(coverage);
    written += coverage.length;
  }
  return written;
}

export async function fetchStatDataset(dataset: StatDatasetDescriptor): Promise<unknown> {
  if (dataset.providerId === "municipal-population") {
    const file = process.env.MAPOS_MUNICIPAL_INPUT;
    if (!file)
      throw Error(
        "Prepare the pinned sources with scripts/prepare-municipal-statistics.mjs and set MAPOS_MUNICIPAL_INPUT"
      );
    if ((await stat(file)).size > 64 * 1024 * 1024) throw Error("Municipal input exceeds 64 MiB");
    const input = JSON.parse(await readFile(file, "utf8"));
    if (
      !input.boundaryEditions ||
      input.sourceSha256 !== "ae07901e0a11cb7891d1a6d6a31cfd833e25672ca318908856b0e34a1acca594"
    )
      throw Error("Municipal source edition mismatch");
    return input;
  }
  if (dataset.nationalAdapter === "pxweb") {
    const options = {
      providerId: dataset.providerId,
      timeoutMs: 60000,
      ttlMs: 6 * 60 * 60_000,
      minIntervalMs: 1000
    };
    const metadata = await fetchJson<{ variables: Array<{ code: string; values: string[] }> }>(
      dataset.endpoint,
      options
    );
    const query = metadata.variables.map((v) => ({
      code: v.code,
      selection: {
        filter: "item",
        values:
          dataset.requestSelection?.[v.code] ??
          (dataset.dimensions?.[v.code]
            ? [dataset.dimensions[v.code]!]
            : v.code === dataset.timeDimension
              ? v.values.filter((y) => y >= "2000")
              : v.values.length === 1
                ? v.values
                : [])
      }
    }));
    if (query.some((q) => !q.selection.values.length)) throw Error("Unresolved PxWeb dimension");
    return fetchJson(dataset.endpoint, {
      ...options,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, response: { format: "json-stat2" } })
    });
  }
  if (dataset.nationalAdapter === "statbank") {
    return fetchJson(dataset.endpoint, {
      providerId: dataset.providerId,
      timeoutMs: 60000,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        table: "FOLK1A",
        format: "JSONSTAT",
        lang: "en",
        variables: Object.entries(dataset.requestSelection ?? {}).map(([code, values]) => ({
          code,
          values
        }))
      })
    });
  }
  return fetchJson<unknown>(dataset.endpoint, {
    providerId: dataset.providerId,
    ttlMs: 6 * 60 * 60_000,
    timeoutMs: 60_000,
    minIntervalMs: 1_000,
    retries: 2,
    maxResponseBytes: 16 * 1024 * 1024
  });
}

export async function persistStatObservations(
  dataset: StatDatasetDescriptor,
  rows: readonly StatObservation[]
): Promise<void> {
  for (const row of rows) {
    await db.execute(dsql`
      INSERT INTO stat_series
        (dataset_id, geo_level, geo_code, period, value, flag, source_id, refreshed_at)
      VALUES (
        ${dataset.id},
        ${dataset.geoLevel},
        ${row.geoCode},
        ${row.period},
        ${row.value},
        ${row.flag ?? null},
        ${dataset.providerId},
        now()
      )
      ON CONFLICT (dataset_id, geo_level, geo_code, period) DO UPDATE SET
        value = EXCLUDED.value,
        flag = EXCLUDED.flag,
        source_id = EXCLUDED.source_id,
        refreshed_at = now()
    `);
  }
}

/** Keeps `stat_datasets` in step with what was actually imported, so the UI can name a unit and
 *  a period range without reading the whole series. */
export async function describeStatDataset(
  dataset: StatDatasetDescriptor,
  periods: readonly string[]
): Promise<void> {
  await db.execute(dsql`
    INSERT INTO stat_datasets
      (id, name, unit, normalization, higher_is_worse, source_id, source_url, license,
       attribution, geo_levels, periods, refreshed_at)
    VALUES (
      ${dataset.id},
      ${dataset.name},
      ${dataset.unit},
      ${dataset.normalization},
      ${dataset.higherIsWorse ? 1 : 0},
      ${dataset.providerId},
      ${dataset.documentationUrl},
      ${dataset.license},
      ${dataset.attribution},
      ${JSON.stringify([dataset.geoLevel])}::jsonb,
      ${JSON.stringify(periods)}::jsonb,
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      normalization = EXCLUDED.normalization,
      higher_is_worse = EXCLUDED.higher_is_worse,
      source_id = EXCLUDED.source_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      geo_levels = EXCLUDED.geo_levels,
      periods = EXCLUDED.periods,
      refreshed_at = now()
  `);
}

export async function importAllStatDatasets(
  ids: readonly string[] = STAT_DATASETS.map((dataset) => dataset.id),
  deps: StatImportDeps = {
    fetchDataset: fetchStatDataset,
    publish: publishStatDataset,
    persist: persistStatObservations,
    describe: describeStatDataset,
    cover: recordDatasetCoverage
  }
): Promise<StatImportResult[]> {
  const results: StatImportResult[] = [];
  for (const dataset of STAT_DATASETS) {
    if (!ids.includes(dataset.id)) continue;
    try {
      results.push(await importStatDataset(dataset, deps));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      if (deps.publish)
        await sql`INSERT INTO stat_import_runs(dataset_id,status,error) VALUES(${dataset.id},'failed',${message.slice(0, 500)})
        ON CONFLICT(dataset_id) DO UPDATE SET status='failed', attempted_at=now(), error=excluded.error`;
      results.push({
        datasetId: dataset.id,
        observations: 0,
        written: 0,
        covered: 0,
        periods: [],
        error: message
      });
    }
  }
  return results;
}

/** Readers only ever observe a complete publication, including coverage and its receipt. */
export async function publishStatDataset(
  dataset: StatDatasetDescriptor,
  rows: readonly StatObservation[],
  periods: readonly string[]
) {
  const revision = createHash("sha256").update(JSON.stringify({ dataset, rows })).digest("hex");
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${dataset.id}))`;
    await tx`DELETE FROM stat_series WHERE dataset_id=${dataset.id}`;
    for (let start = 0; start < rows.length; start += 500) {
      const batch = rows.slice(start, start + 500).map((row) => ({
        dataset_id: dataset.id,
        geo_level: dataset.geoLevel,
        geo_code: row.geoCode,
        period: row.period,
        value: row.value,
        flag: row.flag ?? null,
        source_id: dataset.providerId,
        boundary_edition: row.boundaryEdition ?? dataset.boundaryEdition ?? null
      }));
      await tx`INSERT INTO stat_series ${tx(batch)}`;
    }
    await tx`INSERT INTO stat_datasets(id,name,unit,normalization,higher_is_worse,source_id,source_url,license,attribution,geo_levels,periods,refreshed_at)
      VALUES(${dataset.id},${dataset.name},${dataset.unit},${dataset.normalization},${dataset.higherIsWorse ? 1 : 0},${dataset.providerId},${dataset.documentationUrl},${dataset.license},${dataset.attribution},${JSON.stringify([dataset.geoLevel])}::jsonb,${JSON.stringify([...periods])}::jsonb,now())
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,unit=excluded.unit,normalization=excluded.normalization,higher_is_worse=excluded.higher_is_worse,source_id=excluded.source_id,source_url=excluded.source_url,license=excluded.license,attribution=excluded.attribution,geo_levels=excluded.geo_levels,periods=excluded.periods,refreshed_at=now()`;
    await tx`DELETE FROM theme_coverage WHERE source_id=${dataset.id}`;
    for (const theme of THEMES.filter((t) => t.sources.some((s) => s.datasetId === dataset.id))) {
      await tx`INSERT INTO theme_coverage(theme_id,source_id,geo_level,geo_code,period_from,period_to,observations,quality,refreshed_at)
        SELECT ${theme.id},${dataset.id},geo_level,geo_code,MIN(period),MAX(period),COUNT(value),1,now()
        FROM stat_series WHERE dataset_id=${dataset.id} GROUP BY geo_level,geo_code HAVING COUNT(value)>0`;
    }
    const unmatched = await tx`SELECT COUNT(DISTINCT s.geo_code)::integer AS n FROM stat_series s
      LEFT JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
      WHERE s.dataset_id=${dataset.id} AND g.code IS NULL`;
    await tx`INSERT INTO stat_import_runs(dataset_id,revision,status,published_at,observations,territories,unmatched,periods,boundary_edition)
      VALUES(${dataset.id},${revision},'ready',now(),${rows.length},${new Set(rows.map((r) => r.geoCode)).size},${Number(unmatched[0]?.n ?? 0)},${JSON.stringify([...periods])}::jsonb,${dataset.boundaryEdition ?? null})
      ON CONFLICT(dataset_id) DO UPDATE SET revision=excluded.revision,status='ready',attempted_at=now(),published_at=now(),observations=excluded.observations,
      territories=excluded.territories,unmatched=excluded.unmatched,periods=excluded.periods,boundary_edition=excluded.boundary_edition,error=null`;
  });
}
