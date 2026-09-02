import { defineMigration } from "./migration.js";

/** Durable owner-scoped import reports make commit retries idempotent and rollback auditable. */
export const layerImportsMigration = defineMigration({
  version: "0006",
  name: "layer_imports",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS layer_imports (
        id UUID PRIMARY KEY,
        preview_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        layer_id UUID REFERENCES user_layers(id) ON DELETE SET NULL,
        package_digest CHAR(64) NOT NULL CHECK (package_digest ~ '^[0-9a-f]{64}$'),
        format TEXT NOT NULL CHECK (format IN ('mapos-package', 'geojson', 'csv')),
        manifest JSONB,
        feature_count INTEGER NOT NULL CHECK (feature_count >= 0 AND feature_count <= 1000),
        status TEXT NOT NULL CHECK (status IN ('committed', 'rolled-back')),
        report JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rolled_back_at TIMESTAMPTZ
      )`
    },
    {
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS layer_imports_preview_unique
        ON layer_imports (preview_id)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS layer_imports_owner_created_idx
        ON layer_imports (user_id, created_at DESC, id)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS layer_imports_layer_idx
        ON layer_imports (layer_id)`
    }
  ]
});
