import { defineMigration } from "./migration.js";

/** First-class canonical events. All operations are additive and safe to replay. */
export const eventsMigration = defineMigration({
  version: "0004",
  name: "canonical_events",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        venue_name TEXT NOT NULL,
        normalized_venue TEXT NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('scheduled', 'postponed', 'cancelled', 'rescheduled', 'completed', 'unknown')
        ),
        lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
        lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
        geog geography(Point,4326),
        official_url TEXT,
        organizer_name TEXT,
        normalized_organizer TEXT,
        document JSONB NOT NULL CHECK (
          jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 262144
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    { sql: `CREATE INDEX IF NOT EXISTS events_time_idx ON events (starts_at, id)` },
    { sql: `CREATE INDEX IF NOT EXISTS events_status_time_idx ON events (status, starts_at)` },
    {
      sql: `CREATE INDEX IF NOT EXISTS events_candidate_idx
        ON events (normalized_title, normalized_venue, starts_at)`
    },
    { sql: `CREATE INDEX IF NOT EXISTS events_official_url_idx ON events (official_url)` },
    { sql: `CREATE INDEX IF NOT EXISTS events_geog_gist ON events USING GIST (geog)` },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT,
        attribution TEXT NOT NULL,
        license TEXT,
        confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
        retrieved_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
          CHECK (octet_length(payload::text) <= 131072),
        UNIQUE (provider_id, source_id)
      )`
    },
    { sql: `CREATE INDEX IF NOT EXISTS event_sources_event_idx ON event_sources (event_id)` },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_performers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        role TEXT,
        url TEXT,
        UNIQUE (event_id, normalized_name)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS event_performers_name_idx
        ON event_performers (normalized_name)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_ticket_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        url TEXT NOT NULL,
        label TEXT,
        currency TEXT,
        min_price DOUBLE PRECISION CHECK (min_price IS NULL OR min_price >= 0),
        max_price DOUBLE PRECISION CHECK (max_price IS NULL OR max_price >= 0),
        availability TEXT NOT NULL DEFAULT 'unknown',
        UNIQUE (event_id, source_id, url)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS event_ticket_offers_event_idx
        ON event_ticket_offers (event_id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_series_relations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        related_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        external_series_id TEXT,
        relation_type TEXT NOT NULL CHECK (
          relation_type IN ('occurrence-of', 'rescheduled-from', 'rescheduled-to')
        ),
        CHECK (num_nonnulls(related_event_id, external_series_id) = 1)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS event_series_relations_event_idx
        ON event_series_relations (event_id)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS event_series_relations_external_idx
        ON event_series_relations (external_series_id)`
    }
  ]
});
