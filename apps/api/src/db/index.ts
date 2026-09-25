import { aiChatHistoryMigration } from "./migrations/0026AiChatHistory.js";
import { geoCorrespondenceMigration } from "./migrations/0025GeoCorrespondence.js";
import { aiOverviewMigration } from "./migrations/0024AiOverview.js";
import { providerBudgetsMigration } from "./migrations/0023ProviderBudgets.js";
import { worldLookupIndexesMigration } from "./migrations/0022WorldLookupIndexes.js";
import { gameWorldMigration } from "./migrations/0021GameWorld.js";
import { statReleasesMigration } from "./migrations/0020StatReleases.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { defineMigration } from "./migrations/migration.js";
import { spatialColumnsMigration } from "./migrations/0002_spatialColumns.js";
import { savedPlacesMigration } from "./migrations/0003_savedPlaces.js";
import { eventsMigration } from "./migrations/0004_events.js";
import { identitiesMigration } from "./migrations/0005_identities.js";
import { layerImportsMigration } from "./migrations/0006_layerImports.js";
import { commerceMigration } from "./migrations/0007_commerce.js";
import { rateLimitsAndOperationsMigration } from "./migrations/0008_rateLimitsAndOperations.js";
import { layerImportPreviewsMigration } from "./migrations/0009_layerImportPreviews.js";
import { planCollaborationMigration } from "./migrations/0010PlanCollaboration.js";
import { pinPathsMigration } from "./migrations/0011PinPaths.js";
import { questAnchorsMigration } from "./migrations/0012QuestAnchors.js";
import { sourceBackedLayersMigration } from "./migrations/0013SourceBackedLayers.js";
import { geoUnitsStatSeriesMigration } from "./migrations/0014GeoUnitsStatSeries.js";
import { themeCoverageMigration } from "./migrations/0015ThemeCoverage.js";
import { userTablesMigration } from "./migrations/0016UserTables.js";
import { viewportIndexesMigration } from "./migrations/0017ViewportIndexes.js";
import { geoUnitReleasesMigration } from "./migrations/0018GeoUnitReleases.js";
import { boundaryManifestsMigration } from "./migrations/0019BoundaryManifests.js";
import {
  runVersionedMigrations,
  type MigrationDatabase,
  type MigrationParameter
} from "./migrations/runner.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://mapos:mapos@localhost:5434/mapos";

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });

const BASELINE_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS postgis`,
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  // Older deployments created `users` before profiles, guest identities and server XP existed.
  // Drizzle selects every declared column, so even a login read fails unless all five are added.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS home_country TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest INT NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS xp_total INT NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS user_layers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#10b981',
    slug TEXT NOT NULL UNIQUE,
    is_public INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id UUID NOT NULL REFERENCES user_layers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS trip_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS trip_plans_user_idx ON trip_plans (user_id)`,
  `CREATE TABLE IF NOT EXISTS canonical_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS canonical_places_lnglat_idx ON canonical_places (lng, lat)`,
  `CREATE TABLE IF NOT EXISTS place_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES canonical_places(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS place_sources_source_ref_unique ON place_sources (source, source_ref)`,
  `CREATE INDEX IF NOT EXISTS place_sources_place_idx ON place_sources (place_id)`,
  `CREATE TABLE IF NOT EXISTS social_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS social_follows_unique ON social_follows (user_id, target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS social_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rating INT NOT NULL,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS social_reviews_unique ON social_reviews (user_id, target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS social_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS social_comments_target_idx ON social_comments (target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS content_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS content_drafts_user_idx ON content_drafts (user_id)`,
  `CREATE TABLE IF NOT EXISTS overpass_cache (
    id TEXT PRIMARY KEY,
    categories TEXT NOT NULL,
    bbox_key TEXT NOT NULL,
    data JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS game_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    radius_m DOUBLE PRECISION NOT NULL DEFAULT 200,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS game_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES game_zones(id),
    title TEXT NOT NULL,
    description TEXT,
    reward_points INT NOT NULL DEFAULT 10,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS osm_pois (
    id TEXT PRIMARY KEY,
    osm_id TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    tags JSONB DEFAULT '{}',
    cell_id TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS osm_pois_category_idx ON osm_pois (category)`,
  `CREATE INDEX IF NOT EXISTS osm_pois_lnglat_idx ON osm_pois (lng, lat)`,
  `CREATE INDEX IF NOT EXISTS osm_pois_cell_idx ON osm_pois (cell_id)`,
  `CREATE TABLE IF NOT EXISTS osm_cells (
    id TEXT PRIMARY KEY,
    cell_id TEXT NOT NULL,
    category TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS osm_cells_lookup_idx ON osm_cells (cell_id, category)`,
  `CREATE TABLE IF NOT EXISTS mapy_pois (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT,
    location TEXT,
    poi_type TEXT,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    cell_id TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS mapy_pois_category_idx ON mapy_pois (category)`,
  `CREATE INDEX IF NOT EXISTS mapy_pois_lnglat_idx ON mapy_pois (lng, lat)`,
  `CREATE INDEX IF NOT EXISTS mapy_pois_cell_idx ON mapy_pois (cell_id)`,
  `CREATE TABLE IF NOT EXISTS mapy_cells (
    id TEXT PRIMARY KEY,
    cell_id TEXT NOT NULL,
    category TEXT NOT NULL,
    keyword TEXT NOT NULL,
    lang TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS mapy_cells_lookup_idx ON mapy_cells (cell_id, category)`,
  `CREATE TABLE IF NOT EXISTS park4night_places (
    id TEXT PRIMARY KEY,
    name TEXT,
    code TEXT,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    rating DOUBLE PRECISION,
    reviews INT DEFAULT 0,
    services JSONB DEFAULT '[]',
    photo_thumb TEXT,
    cell_id TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS p4n_places_lnglat_idx ON park4night_places (lng, lat)`,
  `CREATE INDEX IF NOT EXISTS p4n_places_cell_idx ON park4night_places (cell_id)`,
  `CREATE TABLE IF NOT EXISTS park4night_cells (
    id TEXT PRIMARY KEY,
    cell_id TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS photo_cache (
    wikidata_id TEXT PRIMARY KEY,
    url TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS weather_frames (
    ts INT PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS game_ghosts (
    id TEXT PRIMARY KEY,
    cell_id TEXT NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    gotchi_id TEXT,
    spawned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    caught_by UUID REFERENCES users(id) ON DELETE SET NULL,
    caught_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS game_ghosts_cell_idx ON game_ghosts (cell_id)`,
  `ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'place'`,
  `ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS country TEXT`,
  `ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS author_name TEXT`,
  `CREATE INDEX IF NOT EXISTS user_pins_country_idx ON user_pins (country)`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS loot_tier TEXT NOT NULL DEFAULT 'low'`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS loot_table JSONB DEFAULT '[]'`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS zone_kind TEXT NOT NULL DEFAULT 'standard'`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS min_stake_usd DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS active_from TIMESTAMPTZ`,
  `ALTER TABLE game_zones ADD COLUMN IF NOT EXISTS active_until TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS staking_positions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    staked_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    pending_yield_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_withdrawn_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_quest_rewards_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_yield_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS reward_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    quest_id UUID,
    amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS game_encounters (
    id TEXT PRIMARY KEY,
    zone_id UUID REFERENCES game_zones(id),
    lng DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    template_kind TEXT NOT NULL,
    loot_tier TEXT NOT NULL DEFAULT 'low',
    spawned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    engaged_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS game_encounters_zone_idx ON game_encounters (zone_id)`,
  `ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'`,
  `CREATE TABLE IF NOT EXISTS place_enrichment (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS region_summaries (
    region_id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // quest_id is text, not a reference to game_quests: quests anchored to real map features are
  // derived rather than stored, so there is no row for them to point at.
  `CREATE TABLE IF NOT EXISTS quest_completions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_id TEXT NOT NULL,
    reward_points INT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS quest_completions_user_idx ON quest_completions (user_id)`,
  `CREATE TABLE IF NOT EXISTS game_orb_collections (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    orb_id TEXT NOT NULL,
    xp_points INT NOT NULL DEFAULT 10,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS game_orb_collections_user_idx ON game_orb_collections (user_id)`,
  `CREATE TABLE IF NOT EXISTS game_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_profiles_user_game_unique ON game_profiles (user_id, game_id)`,
  `ALTER TABLE quest_completions DROP CONSTRAINT IF EXISTS quest_completions_quest_id_game_quests_id_fk`,
  `ALTER TABLE quest_completions ALTER COLUMN quest_id TYPE TEXT`,
  `ALTER TABLE reward_events ALTER COLUMN quest_id TYPE TEXT`
];

const VERSIONED_MIGRATIONS = [
  defineMigration({
    version: "0001",
    name: "baseline_snapshot",
    steps: BASELINE_STATEMENTS.map((statement) => ({ sql: statement }))
  }),
  spatialColumnsMigration,
  savedPlacesMigration,
  eventsMigration,
  identitiesMigration,
  layerImportsMigration,
  commerceMigration,
  rateLimitsAndOperationsMigration,
  layerImportPreviewsMigration,
  planCollaborationMigration,
  pinPathsMigration,
  questAnchorsMigration,
  sourceBackedLayersMigration,
  geoUnitsStatSeriesMigration,
  themeCoverageMigration,
  userTablesMigration,
  viewportIndexesMigration,
  geoUnitReleasesMigration,
  boundaryManifestsMigration,
  statReleasesMigration,
  gameWorldMigration,
  worldLookupIndexesMigration,
  providerBudgetsMigration,
  aiOverviewMigration,
  geoCorrespondenceMigration,
  aiChatHistoryMigration
] as const;

function migrationMetadata(env: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    actor: env.MAPOS_MIGRATION_ACTOR?.trim() || "mapos-api",
    release: env.MAPOS_RELEASE?.trim() || env.GIT_SHA?.trim() || "unknown-release"
  };
}

async function applyConfiguredMigrations(
  migrationDatabase: MigrationDatabase,
  metadata = migrationMetadata()
) {
  await runVersionedMigrations(migrationDatabase, VERSIONED_MIGRATIONS, metadata);
}

export async function initDb() {
  // A reserved postgres.js connection keeps the advisory lock and every migration statement on
  // one session. Statements remain autocommit-based so GiST indexes can be built CONCURRENTLY.
  const connection = await sql.reserve();
  const migrationDatabase: MigrationDatabase = {
    async execute(statement: string, parameters: MigrationParameter[] = []) {
      const result = await connection.unsafe<Record<string, unknown>[]>(statement, parameters);
      return { rows: [...result], rowCount: result.count ?? result.length };
    }
  };
  try {
    await applyConfiguredMigrations(migrationDatabase, migrationMetadata());
  } finally {
    connection.release();
  }
}

/** Test seam: guards runtime migrations from drifting behind the Drizzle schema again. */
export const __testing = {
  migrations: BASELINE_STATEMENTS,
  versionedMigrations: VERSIONED_MIGRATIONS,
  migrationMetadata,
  applyConfiguredMigrations
};
