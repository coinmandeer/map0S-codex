import { defineMigration } from "./migration.js";

// Published migration 0021 is immutable. Add lookup indexes in a new version.
export const worldLookupIndexesMigration = defineMigration({
  version: "0022",
  name: "world_lookup_indexes",
  steps: [
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
  ].flatMap((name) => [
    { sql: `CREATE INDEX IF NOT EXISTS world_${name}_from ON world_${name} ((data->>'from'))` },
    { sql: `CREATE INDEX IF NOT EXISTS world_${name}_to ON world_${name} ((data->>'to'))` },
    { sql: `CREATE INDEX IF NOT EXISTS world_${name}_pair ON world_${name} ((data->>'pairKey'))` }
  ])
});
