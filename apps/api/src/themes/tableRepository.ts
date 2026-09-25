/**
 * Reading back a user's table definitions.
 *
 * Separate from `tableImport` so the routes can be exercised offline with a fixture repository:
 * everything here needs Postgres, and nothing here needs the parsers.
 */

import { sql as dsql } from "drizzle-orm";
import type { TerritoryLevel } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import type { TableDefinition } from "./tableImport.js";

interface TableRow {
  id: string;
  ownerId: string;
  name: string;
  sourceUrl: string | null;
  format: string;
  encoding: string | null;
  geoLevel: string;
  codeColumn: number;
  valueColumn: number;
  valueLabel: string;
  unit: string | null;
  period: string;
  refreshIntervalMinutes: number | null;
  refreshedAt: string;
}

const COLUMNS = dsql`
  id,
  owner_id AS "ownerId",
  name,
  source_url AS "sourceUrl",
  format,
  encoding,
  geo_level AS "geoLevel",
  code_column AS "codeColumn",
  value_column AS "valueColumn",
  value_label AS "valueLabel",
  unit,
  period,
  refresh_interval_minutes AS "refreshIntervalMinutes",
  refreshed_at AS "refreshedAt"
`;

export async function tableDefinitionById(
  ownerId: string,
  id: string
): Promise<TableDefinition | null> {
  const rows = await db.execute(dsql`
    SELECT ${COLUMNS} FROM user_tables WHERE owner_id = ${ownerId} AND id = ${id}
  `);
  const row = rowsOf<TableRow>(rows)[0];
  return row ? toDefinition(row) : null;
}

export async function tableDefinitionsForOwner(ownerId: string): Promise<TableDefinition[]> {
  const rows = await db.execute(dsql`
    SELECT ${COLUMNS} FROM user_tables WHERE owner_id = ${ownerId} ORDER BY created_at DESC
  `);
  return rowsOf<TableRow>(rows).map(toDefinition);
}

/** Linked tables whose refresh interval has elapsed, oldest first. */
export async function tablesDueForRefresh(limit = 20): Promise<TableDefinition[]> {
  const rows = await db.execute(dsql`
    SELECT ${COLUMNS} FROM user_tables
    WHERE source_url IS NOT NULL
      AND refresh_interval_minutes IS NOT NULL
      AND refreshed_at < now() - make_interval(mins => refresh_interval_minutes)
    ORDER BY refreshed_at
    LIMIT ${limit}
  `);
  return rowsOf<TableRow>(rows).map(toDefinition);
}

function toDefinition(row: TableRow): TableDefinition {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    format: row.format === "xlsx" ? "xlsx" : "csv",
    encoding: row.encoding,
    geoLevel: row.geoLevel as TerritoryLevel,
    codeColumn: Number(row.codeColumn),
    valueColumn: Number(row.valueColumn),
    valueLabel: row.valueLabel,
    unit: row.unit,
    period: row.period,
    refreshIntervalMinutes:
      row.refreshIntervalMinutes === null ? null : Number(row.refreshIntervalMinutes)
  };
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
