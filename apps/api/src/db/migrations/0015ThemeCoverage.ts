import { defineMigration } from "./migration.js";

/**
 * Which source answers for which territory, and for how long.
 *
 * The renderer needs this to do what §23.2 asks: pick the finest source available *per
 * territory*, not per request. Without the table the only honest options are to ask every
 * source about every viewport, or to hardcode "Eurostat for Europe" — and the second one is
 * what makes a map stop at a border for no reason the data supports.
 *
 * It also drives the "Sources" popover. Ordering sources by how much of the current viewport
 * they cover requires knowing their extent before drawing anything, which is exactly one row
 * per territory per source.
 *
 * Filled by the importer rather than by hand: a series is imported, and its coverage is the set
 * of codes it turned out to contain.
 */
export const themeCoverageMigration = defineMigration({
  version: "0015",
  name: "theme_coverage",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS theme_coverage (
        theme_id TEXT NOT NULL,
        /** The dataset, which is what a user switches off in the sources popover. */
        source_id TEXT NOT NULL,
        geo_level TEXT NOT NULL,
        geo_code TEXT NOT NULL,
        period_from TEXT,
        period_to TEXT,
        /** 0–1. Lower for a source whose value had to be converted onto the theme's unit. */
        quality DOUBLE PRECISION NOT NULL DEFAULT 1,
        /** How many periods carry a value, so "covers this area" and "covers it once in 2011"
         *  are distinguishable. */
        observations INTEGER NOT NULL DEFAULT 0,
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (theme_id, source_id, geo_level, geo_code)
      )`
    },
    {
      // The popover's query: everything covering this theme, joined to geometry by level+code.
      sql: `CREATE INDEX IF NOT EXISTS theme_coverage_theme_level_idx
        ON theme_coverage (theme_id, geo_level, geo_code)`
    }
  ]
});
