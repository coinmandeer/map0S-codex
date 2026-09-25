import { defineMigration } from "./migration.js";

export const boundaryManifestsMigration = defineMigration({
  version: "0019",
  name: "boundary_manifests",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS geo_boundary_manifests (
      revision text PRIMARY KEY CHECK (revision ~ '^[a-f0-9]{64}$'),
      release_ids uuid[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    },
    {
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS geo_unit_versions_geom_gist ON geo_unit_versions USING GIST (geom)`,
      concurrentIndex: {
        name: "geo_unit_versions_geom_gist",
        expectedDefinitionFragments: ["geo_unit_versions using gist (geom)"]
      }
    }
  ]
});
