import { defineMigration } from "./migration.js";

export const geoUnitReleasesMigration = defineMigration({
  version: "0018",
  name: "geo_unit_releases",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS geo_unit_releases (
      id uuid PRIMARY KEY, source_id text NOT NULL, provider_id text NOT NULL, level text NOT NULL,
      edition text NOT NULL, license text NOT NULL, attribution text NOT NULL,
      status text NOT NULL CHECK (status IN ('staging','ready','published','failed')),
      created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
      feature_count integer NOT NULL DEFAULT 0
    )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS geo_unit_versions (
      release_id uuid NOT NULL REFERENCES geo_unit_releases(id),
      level text NOT NULL, code text NOT NULL, name text NOT NULL, parent_code text,
      country text, source_id text NOT NULL, edition text, geom geometry(MultiPolygon,4326) NOT NULL,
      centroid geography(Point,4326), area_km2 double precision,
      PRIMARY KEY (release_id,level,code)
    )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS geo_unit_releases_source_idx ON geo_unit_releases(source_id,created_at)`
    }
  ]
});
