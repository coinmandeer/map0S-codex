import { defineMigration } from "./migration.js";

/** Durable, owner-scoped preview payloads allow preview and commit to use different API nodes. */
export const layerImportPreviewsMigration = defineMigration({
  version: "0009",
  name: "layer_import_previews",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS layer_import_previews (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        package_digest CHAR(64) NOT NULL CHECK (package_digest ~ '^[0-9a-f]{64}$'),
        parsed JSONB NOT NULL CHECK (
          jsonb_typeof(parsed) = 'object'
          AND octet_length(parsed::text) <= 8388608
        ),
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS layer_import_previews_owner_created_idx
        ON layer_import_previews (user_id, created_at, id)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS layer_import_previews_expiry_idx
        ON layer_import_previews (expires_at, id)`
    }
  ]
});
