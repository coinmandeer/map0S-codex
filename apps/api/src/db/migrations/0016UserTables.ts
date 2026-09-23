import { defineMigration } from "./migration.js";

/**
 * A user's own table, joined onto `geo_units` and drawn as a choropleth (§20.3).
 *
 * The values themselves go into `stat_series` under a `table:<id>` dataset id rather than into a
 * table of their own. That is the point of the indirection: the tile query, the quantile
 * classification and the click-through already work for a series, and a user's spreadsheet is a
 * series that happens to have been uploaded rather than imported from Eurostat.
 *
 * What is stored here is everything needed to draw it again without the file: which column held
 * the code, which held the value, what level the codes were, and — when it came from a URL —
 * where to fetch it from next time.
 */
export const userTablesMigration = defineMigration({
  version: "0016",
  name: "user_tables",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS user_tables (
        id TEXT PRIMARY KEY,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        /** Absent for an uploaded file: there is nothing to refresh from. */
        source_url TEXT,
        format TEXT NOT NULL,
        encoding TEXT,
        geo_level TEXT NOT NULL,
        code_column INTEGER NOT NULL,
        value_column INTEGER NOT NULL,
        value_label TEXT NOT NULL,
        unit TEXT,
        period TEXT NOT NULL,
        /** Null means "never on its own"; a refresh is then only ever manual. */
        refresh_interval_minutes INTEGER,
        row_count INTEGER NOT NULL DEFAULT 0,
        matched_count INTEGER NOT NULL DEFAULT 0,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS user_tables_owner_idx ON user_tables (owner_id, created_at DESC)`
    },
    {
      // The refresh job's query: everything with a URL, oldest first.
      sql: `CREATE INDEX IF NOT EXISTS user_tables_refresh_idx
        ON user_tables (refreshed_at)
        WHERE source_url IS NOT NULL`
    }
  ]
});
