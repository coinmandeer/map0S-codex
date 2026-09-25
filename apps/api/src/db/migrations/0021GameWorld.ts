import { defineMigration } from "./migration.js";

const tables = [
  "profiles",
  "rewards",
  "contacts",
  "blocks",
  "favorites",
  "threads",
  "messages",
  "reads",
  "quests",
  "reports",
  "raid_results",
  "actions"
];
export const gameWorldMigration = defineMigration({
  version: "0021",
  name: "aavegotchi_social_world",
  steps: tables.flatMap((name) => [
    {
      sql: `CREATE TABLE IF NOT EXISTS world_${name} (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at BIGINT NOT NULL DEFAULT 0, location geography(Point,4326))`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS world_${name}_cursor ON world_${name} (created_at DESC,id)`
    },
    { sql: `CREATE INDEX IF NOT EXISTS world_${name}_geo ON world_${name} USING gist(location)` },
    { sql: `CREATE INDEX IF NOT EXISTS world_${name}_owner ON world_${name} ((data->>'userId'))` },
    {
      sql: `CREATE INDEX IF NOT EXISTS world_${name}_thread ON world_${name} ((data->>'threadId'),created_at DESC)`
    }
  ])
});
