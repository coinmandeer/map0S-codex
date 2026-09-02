import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  canonicalPlaces,
  gameEncounters,
  gameGhosts,
  gameQuests,
  gameZones,
  mapyPois,
  osmPois,
  park4nightPlaces,
  userPins
} from "../schema.js";
import { __testing, spatialColumnsMigration } from "./0002_spatialColumns.js";

const TABLES: Record<string, PgTable> = {
  user_pins: userPins,
  canonical_places: canonicalPlaces,
  osm_pois: osmPois,
  mapy_pois: mapyPois,
  park4night_places: park4nightPlaces,
  game_ghosts: gameGhosts,
  game_zones: gameZones,
  game_quests: gameQuests,
  game_encounters: gameEncounters
};

test("spatial migration is additive, versioned and enables PostGIS", () => {
  assert.equal(spatialColumnsMigration.version, "0002");
  assert.equal(spatialColumnsMigration.name, "spatial_columns");
  assert.match(spatialColumnsMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = spatialColumnsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create extension if not exists postgis/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)/);
  assert.doesNotMatch(sql, /alter\s+column/);
  assert.doesNotMatch(sql, /delete\s+from/);
  assert.doesNotMatch(sql, /set\s+not\s+null/);
});

test("every legacy point table gets compatible geography, guarded backfill and GiST", () => {
  assert.deepEqual(Object.keys(TABLES), [...__testing.pointTables]);
  for (const table of __testing.pointTables) {
    const addColumn = spatialColumnsMigration.steps.find((step) =>
      step.sql.includes(`ALTER TABLE ${table} ADD COLUMN`)
    );
    assert.match(addColumn?.sql ?? "", /ADD COLUMN IF NOT EXISTS geog geography\(Point, 4326\)/);

    const backfill = spatialColumnsMigration.steps.find((step) =>
      step.sql.includes(`UPDATE ${table} AS target`)
    );
    assert.equal(backfill?.repeatUntilNoRows, true);
    assert.match(backfill?.sql ?? "", /WHERE geog IS NULL/);
    assert.match(backfill?.sql ?? "", /lng BETWEEN -180 AND 180/);
    assert.match(backfill?.sql ?? "", /lat BETWEEN -90 AND 90/);
    assert.match(backfill?.sql ?? "", new RegExp(`LIMIT ${__testing.backfillBatchSize}`));
    assert.match(backfill?.sql ?? "", /FOR UPDATE SKIP LOCKED/);
    assert.match(backfill?.sql ?? "", /ST_SetSRID\(ST_MakePoint\(batch.lng, batch.lat\), 4326\)/);

    const spatialIndex = spatialColumnsMigration.steps.find(
      (step) => step.concurrentIndex?.name === `${table}_geog_gist`
    );
    assert.match(spatialIndex?.sql ?? "", /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
    assert.match(spatialIndex?.sql ?? "", /USING GIST \(geog\)/);
  }
});

test("Drizzle schema declares the same nullable spatial columns and GiST indexes", () => {
  for (const [tableName, table] of Object.entries(TABLES)) {
    const config = getTableConfig(table);
    const geog = config.columns.find((column) => column.name === "geog");
    assert.equal(geog?.getSQLType(), "geography(Point,4326)", `${tableName}.geog type`);
    assert.equal(geog?.notNull, false, `${tableName}.geog must remain nullable during dual write`);
    const index = config.indexes.find(
      (candidate) => candidate.config.name === `${tableName}_geog_gist`
    );
    assert.equal(index?.config.method, "gist", `${tableName}.geog GiST schema metadata`);
  }

  const zoneConfig = getTableConfig(gameZones);
  const geometry = zoneConfig.columns.find((column) => column.name === "geom");
  assert.equal(geometry?.getSQLType(), "geometry(Polygon,4326)");
  assert.equal(
    zoneConfig.indexes.find((index) => index.config.name === "game_zones_geom_gist")?.config.method,
    "gist"
  );
});

test("game-zone polygon backfill is bounded and rejects impossible legacy coordinates/radii", () => {
  const addGeometry = spatialColumnsMigration.steps.find((step) =>
    step.sql.includes("ADD COLUMN IF NOT EXISTS geom")
  );
  assert.match(addGeometry?.sql ?? "", /geometry\(Polygon, 4326\)/);
  const backfill = spatialColumnsMigration.steps.find(
    (step) => step.sql.includes("UPDATE game_zones AS target") && step.sql.includes("SET geom")
  );
  assert.equal(backfill?.repeatUntilNoRows, true);
  assert.match(backfill?.sql ?? "", /radius_m BETWEEN 0 AND 1000000/);
  assert.match(backfill?.sql ?? "", /ST_Buffer/);
  assert.match(backfill?.sql ?? "", /::geometry\(Polygon, 4326\)/);
});
