import { defineMigration } from "./migration.js";
export const statReleasesMigration = defineMigration({
  version: "0020",
  name: "stat_releases",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS stat_import_runs (
      dataset_id text PRIMARY KEY, revision text, status text NOT NULL,
      attempted_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
      observations integer NOT NULL DEFAULT 0, territories integer NOT NULL DEFAULT 0,
      unmatched integer NOT NULL DEFAULT 0, periods jsonb NOT NULL DEFAULT '[]',
      boundary_edition text, error text
    )`
    },
    { sql: `ALTER TABLE stat_series ADD COLUMN IF NOT EXISTS boundary_edition text` },
    {
      sql: `CREATE INDEX IF NOT EXISTS stat_series_unit_period ON stat_series(dataset_id,geo_level,geo_code,period DESC)`
    }
  ]
});
