import { defineMigration } from "./migration.js";

/**
 * The two tables every thematic overlay is built on: territories and numbers about them.
 *
 * They are separate on purpose. A boundary is expensive to store and almost never changes —
 * NUTS is revised every three years — while a statistic arrives per period, per dataset, for
 * the same boundary over and over. Keeping them apart means Eurostat's crime series and its
 * population series share one copy of the geometry, and adding a dataset costs rows in
 * `stat_series` alone.
 *
 * The join key is `(level, code)` rather than a surrogate id, because that pair is what every
 * upstream actually publishes: `NUTS3/CZ032`, `country/DE`, `lau/CZ0326546`. A table import
 * matching on the code column of somebody's spreadsheet needs no lookup step at all.
 */
export const geoUnitsStatSeriesMigration = defineMigration({
  version: "0014",
  name: "geo_units_stat_series",
  steps: [
    {
      // MultiPolygon rather than Polygon: a country with islands is the normal case, not the
      // exception, and splitting Greece into rows would break the one-row-per-code join.
      sql: `CREATE TABLE IF NOT EXISTS geo_units (
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        /** The parent in the same hierarchy, so NUTS3 can roll up without a spatial query. */
        parent_code TEXT,
        /** ISO 3166-1 alpha-2, present on every level, so "just this country" is one filter. */
        country TEXT,
        source_id TEXT NOT NULL,
        /** Which edition the boundary came from: NUTS 2024, geoBoundaries 6.0.0. */
        edition TEXT,
        geom geometry(MultiPolygon, 4326) NOT NULL,
        /** Point to hang a label or a value bubble on, from the source when it offers one. */
        centroid geography(Point, 4326),
        area_km2 DOUBLE PRECISION,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (level, code)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS geo_units_country_level_idx
        ON geo_units (country, level)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS geo_units_parent_idx ON geo_units (parent_code)`
    },
    {
      // Autocommit, matching migrations 0002 and 0012: CONCURRENTLY cannot run in a
      // transaction, and this index is what makes a viewport query a viewport query.
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS geo_units_geom_gist
        ON geo_units USING GIST (geom)`,
      concurrentIndex: {
        name: "geo_units_geom_gist",
        expectedDefinitionFragments: ["geo_units using gist (geom)"]
      }
    },
    {
      // `period` is text, not a date: upstream periods are years ("2023"), quarters ("2023-Q1")
      // and months, and a date column would force every one of them into a fake day. Sorting
      // ISO-8601-ordered period strings gives the right order anyway.
      sql: `CREATE TABLE IF NOT EXISTS stat_series (
        dataset_id TEXT NOT NULL,
        geo_level TEXT NOT NULL,
        geo_code TEXT NOT NULL,
        period TEXT NOT NULL,
        value DOUBLE PRECISION,
        /** Present when the source publishes a flag: "p" provisional, "e" estimated, ":" none. */
        flag TEXT,
        source_id TEXT NOT NULL,
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (dataset_id, geo_level, geo_code, period)
      )`
    },
    {
      // The renderer asks one question — every value for this dataset, level and period — so
      // that is the index. Without it, colouring Europe is a sequential scan of every series.
      sql: `CREATE INDEX IF NOT EXISTS stat_series_dataset_period_idx
        ON stat_series (dataset_id, geo_level, period)`
    },
    {
      // A dataset describes itself: unit, what a high value means, where it came from. Kept
      // beside the values so a series is never an orphan column of unlabelled numbers.
      sql: `CREATE TABLE IF NOT EXISTS stat_datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT,
        /** "raw" | "per_100k" | "per_km2" | "percent" — how the stored value is normalised. */
        normalization TEXT NOT NULL DEFAULT 'raw',
        /** Whether a higher value is worse, so a theme can pick the right colour direction. */
        higher_is_worse INTEGER NOT NULL DEFAULT 0,
        source_id TEXT NOT NULL,
        source_url TEXT,
        license TEXT,
        attribution TEXT,
        geo_levels JSONB NOT NULL DEFAULT '[]'::jsonb,
        periods JSONB NOT NULL DEFAULT '[]'::jsonb,
        refreshed_at TIMESTAMPTZ
      )`
    }
  ]
});
