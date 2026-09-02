import { defineMigration } from "./migration.js";

/**
 * First-class Personal bookmarks. This is intentionally additive: follows, public user pins and
 * viewport results keep their existing meanings and are never silently reclassified as saves.
 */
export const savedPlacesMigration = defineMigration({
  version: "0003",
  name: "saved_places",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS saved_place_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        icon TEXT CHECK (icon IS NULL OR char_length(icon) <= 80),
        color TEXT CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
        visibility TEXT NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'unlisted', 'public')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, id),
        UNIQUE (user_id, name)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS saved_place_collections_user_idx
        ON saved_place_collections (user_id, name, id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS saved_places (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        canonical_place_id UUID,
        user_pin_id UUID,
        external_feature_ref TEXT
          CHECK (external_feature_ref IS NULL OR char_length(external_feature_ref) BETWEEN 1 AND 320),
        embedded_snapshot JSONB,
        source_snapshot JSONB,
        category TEXT NOT NULL DEFAULT 'place'
          CHECK (char_length(category) BETWEEN 1 AND 80),
        note TEXT CHECK (note IS NULL OR char_length(note) <= 4000),
        tags JSONB NOT NULL DEFAULT '[]'::jsonb
          CHECK (
            jsonb_typeof(tags) = 'array'
            AND jsonb_array_length(tags) <= 24
            AND octet_length(tags::text) <= 4096
          ),
        collection_id UUID,
        sort_order INTEGER NOT NULL DEFAULT 0
          CHECK (sort_order BETWEEN -1000000000 AND 1000000000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT saved_places_exactly_one_target CHECK (
          num_nonnulls(canonical_place_id, user_pin_id, external_feature_ref, embedded_snapshot) = 1
        ),
        CONSTRAINT saved_places_snapshot_policy CHECK (
          (embedded_snapshot IS NOT NULL AND source_snapshot IS NULL)
          OR (embedded_snapshot IS NULL AND source_snapshot IS NOT NULL)
        ),
        CONSTRAINT saved_places_snapshot_bounds CHECK (
          (embedded_snapshot IS NULL OR (
            jsonb_typeof(embedded_snapshot) = 'object'
            AND octet_length(embedded_snapshot::text) <= 32768
          ))
          AND (source_snapshot IS NULL OR (
            jsonb_typeof(source_snapshot) = 'object'
            AND octet_length(source_snapshot::text) <= 32768
          ))
        ),
        CONSTRAINT saved_places_collection_owner_fk
          FOREIGN KEY (user_id, collection_id)
          REFERENCES saved_place_collections (user_id, id)
          ON DELETE RESTRICT
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS saved_places_user_cursor_idx
        ON saved_places (user_id, sort_order, created_at DESC, id DESC)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS saved_places_user_category_idx
        ON saved_places (user_id, category)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS saved_places_user_collection_idx
        ON saved_places (user_id, collection_id)`
    }
  ]
});
