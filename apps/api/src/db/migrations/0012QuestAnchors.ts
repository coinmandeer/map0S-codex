import { defineMigration } from "./migration.js";

/**
 * A cache of the anchors the quest source adapters return.
 *
 * Until now every viewport asked Opencaching, the OSM notes API, Turf and the Wiki Loves
 * Monuments toolserver directly, so panning the map was a burst of third-party calls. Those are
 * volunteer-run services with rate limits, and none of the data moves: a cache, a note and a
 * Turf zone stay where they are for hours or years. Caching turns a pan into one indexed query
 * and keeps a fork from being the reason a community API starts refusing requests.
 *
 * `refreshed_at` is what makes the cache honest rather than a snapshot: a row past its source's
 * refresh window is re-read, and one whose source has gone away simply stops being renewed.
 */
export const questAnchorsMigration = defineMigration({
  version: "0012",
  name: "quest_anchors",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS quest_anchors (
        ref TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT,
        lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
        lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
        geog geography(Point, 4326),
        weight DOUBLE PRECISION,
        radius_m DOUBLE PRECISION,
        description TEXT,
        external_url TEXT,
        refreshed_at TIMESTAMPTZ NOT NULL
      )`
    },
    {
      // The bbox query filters by source before geography, because switching a source off has
      // to stop costing anything at all.
      sql: `CREATE INDEX IF NOT EXISTS quest_anchors_source_refreshed_idx
        ON quest_anchors (source_id, refreshed_at)`
    },
    {
      // Autocommit, matching migration 0002: PostgreSQL forbids CONCURRENTLY in a transaction.
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS quest_anchors_geog_gist
        ON quest_anchors USING GIST (geog)`,
      concurrentIndex: {
        name: "quest_anchors_geog_gist",
        expectedDefinitionFragments: ["quest_anchors using gist (geog)"]
      }
    },
    {
      // Records which viewports have already been fetched, so an area that genuinely holds no
      // caches is remembered as empty instead of being asked about on every single pan.
      sql: `CREATE TABLE IF NOT EXISTS quest_anchor_sweeps (
        source_id TEXT NOT NULL,
        cell TEXT NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL,
        anchor_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (source_id, cell)
      )`
    }
  ]
});
