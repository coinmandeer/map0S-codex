/**
 * Imported tables in offline mode.
 *
 * The parsing, detection and joining are the real code — only the storage and the network are
 * replaced. That is what makes the offline run worth anything: an e2e that uploads a CSV
 * exercises the same column detection a production import would, and fails the same way when it
 * regresses.
 */

import type { TableDefinition, TableIngestDeps } from "./tableImport.js";
import type { TableJoin, TableObservation } from "@mapos/layer-sdk";

interface StoredTable {
  definition: TableDefinition;
  observations: TableObservation[];
  period: string;
  level: string;
}

const TABLES = new Map<string, StoredTable>();

/** The fixture territories the offline theme tiles draw, so an uploaded table can match them. */
const FIXTURE_CODES = new Set(["CZ031", "CZ032", "CZ041", "CZ010", "CZ", "SK", "AT", "PL", "DE"]);

/** A CSV the offline wizard and the e2e can point at, served by the fixture route below. */
export const FIXTURE_TABLE_CSV = [
  "kod;nazev;hodnota",
  "CZ031;Jihočeský kraj;640,1",
  "CZ032;Plzeňský kraj;811,4",
  "CZ041;Karlovarský kraj;1 002",
  "CZ010;Praha;1 240,7"
].join("\n");

export const fixtureTableIngestDeps: TableIngestDeps = {
  async fetchTable(url) {
    return {
      bytes: new TextEncoder().encode(FIXTURE_TABLE_CSV),
      filename: new URL(url).pathname.split("/").pop() || "table.csv"
    };
  },

  async persist(datasetId, level, period, rows) {
    const stored = TABLES.get(datasetId.replace(/^table:/, ""));
    if (stored) {
      stored.observations = [...rows];
      stored.period = period;
      stored.level = level;
    } else {
      PENDING.set(datasetId.replace(/^table:/, ""), {
        observations: [...rows],
        period,
        level
      });
    }
  },

  async countMatched(_level, codes) {
    return codes.filter((code) => FIXTURE_CODES.has(code)).length;
  },

  async saveDefinition(definition: TableDefinition, _join: TableJoin, _matched: number) {
    const pending = PENDING.get(definition.id);
    TABLES.set(definition.id, {
      definition,
      observations: pending?.observations ?? TABLES.get(definition.id)?.observations ?? [],
      period: pending?.period ?? definition.period,
      level: pending?.level ?? definition.geoLevel
    });
    PENDING.delete(definition.id);
  }
};

/** Values arrive before the definition they belong to, because the ingest persists first. */
const PENDING = new Map<
  string,
  { observations: TableObservation[]; period: string; level: string }
>();

export async function fixtureTableById(
  ownerId: string,
  id: string
): Promise<TableDefinition | null> {
  const stored = TABLES.get(id);
  return stored && stored.definition.ownerId === ownerId ? stored.definition : null;
}

export async function fixtureTablesForOwner(ownerId: string): Promise<TableDefinition[]> {
  return [...TABLES.values()]
    .filter((stored) => stored.definition.ownerId === ownerId)
    .map((stored) => stored.definition);
}

/** What a table holds, for the offline tile and metadata queries. */
export function fixtureTableSeries(datasetId: string): StoredTable | null {
  return TABLES.get(datasetId.replace(/^table:/, "")) ?? null;
}

export function resetFixtureTables(): void {
  TABLES.clear();
  PENDING.clear();
}
