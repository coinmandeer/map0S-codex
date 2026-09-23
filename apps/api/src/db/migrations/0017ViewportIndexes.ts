import { defineMigration } from "./migration.js";

export const viewportIndexesMigration = defineMigration({
  version: "0017",
  name: "viewport_indexes",
  steps: [
    {
      sql: `CREATE OR REPLACE FUNCTION mapos_pin_geometry(lng double precision, lat double precision, path jsonb)
      RETURNS geometry LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
      BEGIN
        IF jsonb_typeof(path) = 'array' AND jsonb_array_length(path) >= 2 THEN
          BEGIN
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(path) point WHERE
              jsonb_typeof(point) <> 'array' OR jsonb_array_length(point) < 2 OR
              jsonb_typeof(point->0) <> 'number' OR jsonb_typeof(point->1) <> 'number' OR
              (point->>0)::double precision NOT BETWEEN -180 AND 180 OR
              (point->>1)::double precision NOT BETWEEN -90 AND 90) THEN
              RETURN ST_SetSRID(ST_MakePoint(lng, lat), 4326);
            END IF;
            RETURN ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', path)::text), 4326);
          EXCEPTION WHEN OTHERS THEN
            RETURN ST_SetSRID(ST_MakePoint(lng, lat), 4326);
          END;
        END IF;
        RETURN ST_SetSRID(ST_MakePoint(lng, lat), 4326);
      END $$`
    },
    {
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS user_pins_shape_gist
      ON user_pins USING GIST (mapos_pin_geometry(lng, lat, path))`,
      concurrentIndex: {
        name: "user_pins_shape_gist",
        expectedDefinitionFragments: ["using gist (mapos_pin_geometry(lng, lat, path))"]
      }
    },
    {
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS osm_pois_category_viewport_idx
      ON osm_pois (category, lng, lat)`,
      concurrentIndex: {
        name: "osm_pois_category_viewport_idx",
        expectedDefinitionFragments: ["osm_pois using btree (category, lng, lat)"]
      }
    }
  ]
});
