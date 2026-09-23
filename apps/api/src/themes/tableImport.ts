/**
 * A user's spreadsheet, turned into a drawable series (§20.3).
 *
 * The shape of the work is: decode → detect → join → store as `stat_series`. Storing it as a
 * series rather than as its own thing is what makes the rest free — the tile endpoint, the
 * quantile classification, the click-through and the legend already exist for Eurostat data and
 * do not care where the numbers came from.
 *
 * Detection reports what it found and the caller confirms it. A preview that guessed the wrong
 * column and imported anyway produces a map that is confidently wrong, which is worse than one
 * that asks.
 */

import { randomUUID } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import {
  detectTerritoryColumn,
  detectValueColumns,
  joinTable,
  parseTable,
  type TableJoin,
  type TableObservation,
  type TerritoryLevel
} from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { ClientError } from "../utils/clientError.js";
import { fetchBytes } from "../utils/upstream.js";

/** 5 MiB, the same ceiling the layer import uses. A statistical table is text; a bigger file is
 *  almost always a whole database export that belongs in a different pipeline. */
export const TABLE_MAX_BYTES = 5 * 1024 * 1024;

export interface TablePreview {
  format: "csv" | "xlsx";
  encoding: string | null;
  delimiter: string | null;
  headers: string[];
  /** The first rows, for the confirmation step. */
  sample: string[][];
  rowCount: number;
  codeColumn: number | null;
  geoLevel: TerritoryLevel | null;
  valueColumns: number[];
  matched: number;
  warnings: string[];
}

export interface TableDefinition {
  id: string;
  ownerId: string;
  name: string;
  sourceUrl: string | null;
  format: "csv" | "xlsx";
  encoding: string | null;
  geoLevel: TerritoryLevel;
  codeColumn: number;
  valueColumn: number;
  valueLabel: string;
  unit: string | null;
  period: string;
  refreshIntervalMinutes: number | null;
}

export function tableDatasetId(id: string): string {
  return `table:${id}`;
}

export function previewTable(bytes: Uint8Array, filename: string): TablePreview {
  if (bytes.byteLength > TABLE_MAX_BYTES) {
    throw new ClientError("Tabulka je větší než 5 MiB.", 413);
  }
  let parsed;
  try {
    parsed = parseTable(bytes, filename);
  } catch (error) {
    throw new ClientError(error instanceof Error ? error.message : "Tabulku nejde přečíst.", 400);
  }
  if (parsed.rows.length < 2) throw new ClientError("Tabulka nemá žádné řádky s daty.", 400);

  const territory = detectTerritoryColumn(parsed.rows);
  const valueColumns = territory ? detectValueColumns(parsed.rows, territory.index) : [];
  const warnings: string[] = [];
  if (!territory) warnings.push("Nenašli jsme sloupec s kódem území — vyberte ho ručně.");
  else if (territory.matched < territory.total) {
    warnings.push(
      `${territory.total - territory.matched} řádků nevypadá jako kód území (${territory.level}).`
    );
  }
  if (!valueColumns.length) warnings.push("Nenašli jsme číselný sloupec s hodnotou.");

  return {
    format: parsed.format,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    headers: (parsed.rows[0] ?? []).map((header) => header.trim()),
    sample: parsed.rows.slice(1, 6),
    rowCount: parsed.rows.length - 1,
    codeColumn: territory?.index ?? null,
    geoLevel: territory?.level ?? null,
    valueColumns,
    matched: territory?.matched ?? 0,
    warnings
  };
}

export interface TableIngestResult {
  definition: TableDefinition;
  written: number;
  /** How many of the joined codes exist in `geo_units` — the number that will actually draw. */
  matched: number;
  warnings: string[];
}

export interface TableIngestDeps {
  fetchTable: (url: string) => Promise<{ bytes: Uint8Array; filename: string }>;
  persist: (
    datasetId: string,
    level: string,
    period: string,
    rows: readonly TableObservation[]
  ) => Promise<void>;
  countMatched: (level: string, codes: readonly string[]) => Promise<number>;
  saveDefinition: (definition: TableDefinition, join: TableJoin, matched: number) => Promise<void>;
}

export const defaultTableIngestDeps: TableIngestDeps = {
  fetchTable: fetchRemoteTable,
  persist: persistTableObservations,
  countMatched: countMatchedGeoUnits,
  saveDefinition: saveTableDefinition
};

export interface TableIngestInput {
  ownerId: string;
  name: string;
  bytes?: Uint8Array;
  filename?: string;
  sourceUrl?: string;
  codeColumn?: number;
  valueColumn?: number;
  geoLevel?: TerritoryLevel;
  unit?: string;
  period?: string;
  refreshIntervalMinutes?: number | null;
  id?: string;
}

export async function ingestTable(
  input: TableIngestInput,
  deps: TableIngestDeps = defaultTableIngestDeps
): Promise<TableIngestResult> {
  const source = input.bytes
    ? { bytes: input.bytes, filename: input.filename ?? "table.csv" }
    : input.sourceUrl
      ? await deps.fetchTable(input.sourceUrl)
      : null;
  if (!source) throw new ClientError("Chybí soubor i odkaz na tabulku.", 400);

  const parsed = parseTable(source.bytes, source.filename);
  const join = joinTable(parsed.rows, {
    codeColumn: input.codeColumn,
    valueColumn: input.valueColumn,
    level: input.geoLevel
  });

  const id = input.id ?? randomUUID();
  const period = input.period ?? String(new Date().getUTCFullYear());
  const definition: TableDefinition = {
    id,
    ownerId: input.ownerId,
    name: input.name,
    sourceUrl: input.sourceUrl ?? null,
    format: parsed.format,
    encoding: parsed.encoding,
    geoLevel: join.level,
    codeColumn: join.codeColumn,
    valueColumn: join.valueColumn,
    valueLabel: (parsed.rows[0]?.[join.valueColumn] ?? "hodnota").trim() || "hodnota",
    unit: input.unit ?? null,
    period,
    refreshIntervalMinutes: input.refreshIntervalMinutes ?? null
  };

  await deps.persist(tableDatasetId(id), join.level, period, join.observations);
  const matched = await deps.countMatched(
    join.level,
    join.observations.map((entry) => entry.geoCode)
  );

  const warnings = [...join.warnings];
  if (matched < join.observations.length) {
    // The commonest cause is a table of one country's regions joined at the wrong level, and
    // saying how many landed is what lets the user notice before trusting the map.
    warnings.push(
      `${join.observations.length - matched} kódů jsme v mapě nenašli — zkontrolujte úroveň území.`
    );
  }

  await deps.saveDefinition(definition, join, matched);
  return { definition, written: join.observations.length, matched, warnings };
}

/** Re-fetches a table that came from a URL and replaces its values. */
export async function refreshTable(
  definition: TableDefinition,
  deps: TableIngestDeps = defaultTableIngestDeps
): Promise<TableIngestResult> {
  if (!definition.sourceUrl) {
    throw new ClientError("Tahle tabulka nemá odkaz, ze kterého by šla obnovit.", 400);
  }
  return ingestTable(
    {
      id: definition.id,
      ownerId: definition.ownerId,
      name: definition.name,
      sourceUrl: definition.sourceUrl,
      // The columns are kept, not re-detected: a publisher adding a column should not silently
      // move the map onto a different number.
      codeColumn: definition.codeColumn,
      valueColumn: definition.valueColumn,
      geoLevel: definition.geoLevel,
      unit: definition.unit ?? undefined,
      period: definition.period,
      refreshIntervalMinutes: definition.refreshIntervalMinutes
    },
    deps
  );
}

/** Which linked tables are due, oldest first. */
export function dueForRefresh(
  tables: ReadonlyArray<{
    sourceUrl: string | null;
    refreshIntervalMinutes: number | null;
    refreshedAt: string;
  }>,
  now: Date
): number[] {
  return tables
    .map((table, index) => ({ table, index }))
    .filter(({ table }) => {
      if (!table.sourceUrl || !table.refreshIntervalMinutes) return false;
      const age = now.getTime() - new Date(table.refreshedAt).getTime();
      return age >= table.refreshIntervalMinutes * 60_000;
    })
    .sort(
      (a, b) => new Date(a.table.refreshedAt).getTime() - new Date(b.table.refreshedAt).getTime()
    )
    .map(({ index }) => index);
}

async function fetchRemoteTable(url: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const { body } = await fetchBytes(url, {
    providerId: "user-table",
    ttlMs: 0,
    timeoutMs: 30_000,
    minIntervalMs: 1_000,
    retries: 1,
    maxResponseBytes: TABLE_MAX_BYTES,
    // Publishers serve a CSV as anything from `text/csv` to `application/octet-stream`, and a
    // spreadsheet as one of two long OOXML types. Refusing on content type alone would reject
    // files that parse perfectly, so the parser is left to be the judge.
    acceptedContentTypes: [
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ]
  });
  const filename = new URL(url).pathname.split("/").pop() || "table.csv";
  return { bytes: new Uint8Array(body), filename };
}

async function persistTableObservations(
  datasetId: string,
  level: string,
  period: string,
  rows: readonly TableObservation[]
): Promise<void> {
  // Replaced rather than merged: a refreshed table that dropped a region should drop it from
  // the map too, and an upsert alone would leave last week's value drawn under a new legend.
  await db.execute(dsql`DELETE FROM stat_series WHERE dataset_id = ${datasetId}`);
  for (const row of rows) {
    await db.execute(dsql`
      INSERT INTO stat_series
        (dataset_id, geo_level, geo_code, period, value, source_id, refreshed_at)
      VALUES (${datasetId}, ${level}, ${row.geoCode}, ${period}, ${row.value}, 'user-table', now())
      ON CONFLICT (dataset_id, geo_level, geo_code, period) DO UPDATE SET
        value = EXCLUDED.value,
        refreshed_at = now()
    `);
  }
}

async function countMatchedGeoUnits(level: string, codes: readonly string[]): Promise<number> {
  if (!codes.length) return 0;
  const rows = await db.execute(dsql`
    SELECT COUNT(*)::int AS matched
    FROM geo_units
    WHERE level = ${level} AND code = ANY(${codes as string[]})
  `);
  const first = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []))[0] as
    { matched?: number } | undefined;
  return Number(first?.matched ?? 0);
}

async function saveTableDefinition(
  definition: TableDefinition,
  join: TableJoin,
  matched: number
): Promise<void> {
  await db.execute(dsql`
    INSERT INTO user_tables
      (id, owner_id, name, source_url, format, encoding, geo_level, code_column, value_column,
       value_label, unit, period, refresh_interval_minutes, row_count, matched_count, warnings,
       refreshed_at)
    VALUES (
      ${definition.id}, ${definition.ownerId}, ${definition.name}, ${definition.sourceUrl},
      ${definition.format}, ${definition.encoding}, ${definition.geoLevel},
      ${definition.codeColumn}, ${definition.valueColumn}, ${definition.valueLabel},
      ${definition.unit}, ${definition.period}, ${definition.refreshIntervalMinutes},
      ${join.observations.length}, ${matched}, ${JSON.stringify(join.warnings)}::jsonb, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      source_url = EXCLUDED.source_url,
      format = EXCLUDED.format,
      encoding = EXCLUDED.encoding,
      geo_level = EXCLUDED.geo_level,
      code_column = EXCLUDED.code_column,
      value_column = EXCLUDED.value_column,
      value_label = EXCLUDED.value_label,
      unit = EXCLUDED.unit,
      period = EXCLUDED.period,
      refresh_interval_minutes = EXCLUDED.refresh_interval_minutes,
      row_count = EXCLUDED.row_count,
      matched_count = EXCLUDED.matched_count,
      warnings = EXCLUDED.warnings,
      refreshed_at = now()
  `);
}
