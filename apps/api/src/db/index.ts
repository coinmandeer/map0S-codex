import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://mapos:mapos@localhost:5434/mapos";

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });

const MIGRATIONS = [
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
  `ALTER TABLE quest_completions DROP CONSTRAINT IF EXISTS quest_completions_quest_id_game_quests_id_fk`,
  `ALTER TABLE quest_completions ALTER COLUMN quest_id TYPE TEXT`,
  `ALTER TABLE reward_events ALTER COLUMN quest_id TYPE TEXT`
];

export async function initDb() {
  for (const stmt of MIGRATIONS) {
    await sql.unsafe(stmt);
  }
}
