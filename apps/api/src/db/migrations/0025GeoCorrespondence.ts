import { defineMigration } from "./migration.js";
export const geoCorrespondenceMigration = defineMigration({
  version: "0025",
  name: "official_geo_correspondence",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS geo_unit_correspondences (
    source_id TEXT NOT NULL, source_level TEXT NOT NULL, source_code TEXT NOT NULL, source_edition TEXT NOT NULL,
    target_source_id TEXT NOT NULL, target_level TEXT NOT NULL, target_code TEXT NOT NULL, target_edition TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation IN ('part_of','same_entity')),
    provenance_url TEXT NOT NULL, source_sha256 CHAR(64) NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source_id,source_level,source_code,source_edition,target_source_id,target_level,target_edition)
  )`
    }
  ]
});
