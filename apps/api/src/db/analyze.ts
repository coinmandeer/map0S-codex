import { sql } from "./index.js";
import { safeErrorLogFields } from "../utils/clientError.js";

const TABLE = /^[a-z_][a-z0-9_]*$/;

/**
 * Refreshes planner statistics for tables an import just rewrote. Autovacuum gets there
 * eventually, but until it does the planner works from the empty table it last saw — it guessed
 * 139 rows for a 242 000-row join and picked nested loops. Never fails the import: slow queries
 * are better than a lost import.
 */
export async function analyzeTables(tables: readonly string[], run: typeof sql = sql) {
  for (const table of tables) {
    if (!TABLE.test(table)) throw new Error(`Not a table name: ${table}`);
    try {
      await run.unsafe(`ANALYZE ${table}`);
    } catch (error) {
      console.warn(`ANALYZE ${table} failed`, safeErrorLogFields(error));
    }
  }
}
