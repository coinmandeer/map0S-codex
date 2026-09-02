import { defineMigration, type MigrationStep } from "./migration.js";

const POINT_TABLES = [
  "user_pins",
  "canonical_places",
  "osm_pois",
  "mapy_pois",
  "park4night_places",
  "game_ghosts",
  "game_zones",
  "game_quests",
  "game_encounters"
] as const;

const BACKFILL_BATCH_SIZE = 5_000;

function pointBackfill(table: (typeof POINT_TABLES)[number]): MigrationStep {
  return {
    sql: `WITH batch AS (
      SELECT ctid, lng, lat
      FROM ${table}
      WHERE geog IS NULL
        AND lng BETWEEN -180 AND 180
        AND lat BETWEEN -90 AND 90
      LIMIT ${BACKFILL_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${table} AS target
    SET geog = ST_SetSRID(ST_MakePoint(batch.lng, batch.lat), 4326)::geography
    FROM batch
    WHERE target.ctid = batch.ctid`,
    repeatUntilNoRows: true
  };
}

const addPointColumns = POINT_TABLES.map((table) => ({
  sql: `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)`
}));

const backfillPoints = POINT_TABLES.map(pointBackfill);

const pointIndexes = POINT_TABLES.map((table) => ({
  // This migration is intentionally autocommit-based: PostgreSQL forbids CONCURRENTLY inside a
  // transaction, and every preceding step is idempotent if a process stops before the ledger row.
  sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${table}_geog_gist ON ${table} USING GIST (geog)`,
  concurrentIndex: {
    name: `${table}_geog_gist`,
    expectedDefinitionFragments: [`${table} using gist (geog)`]
  }
}));

export const spatialColumnsMigration = defineMigration({
  version: "0002",
  name: "spatial_columns",
  steps: [
    { sql: "CREATE EXTENSION IF NOT EXISTS postgis" },
    ...addPointColumns,
    {
      sql: "ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS geom geometry(Polygon, 4326)"
    },
    ...backfillPoints,
    {
      sql: `WITH batch AS (
        SELECT ctid, lng, lat, radius_m
        FROM game_zones
        WHERE geom IS NULL
          AND lng BETWEEN -180 AND 180
          AND lat BETWEEN -90 AND 90
          AND radius_m BETWEEN 0 AND 1000000
        LIMIT ${BACKFILL_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE game_zones AS target
      SET geom = ST_Buffer(
        ST_SetSRID(ST_MakePoint(batch.lng, batch.lat), 4326)::geography,
        batch.radius_m
      )::geometry(Polygon, 4326)
      FROM batch
      WHERE target.ctid = batch.ctid`,
      repeatUntilNoRows: true
    },
    ...pointIndexes,
    {
      sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS game_zones_geom_gist ON game_zones USING GIST (geom)",
      concurrentIndex: {
        name: "game_zones_geom_gist",
        expectedDefinitionFragments: ["game_zones using gist (geom)"]
      }
    }
  ]
});

export const __testing = { pointTables: POINT_TABLES, backfillBatchSize: BACKFILL_BATCH_SIZE };
