import { defineMigration } from "./migration.js";

/**
 * A user layer that is a source rather than a collection of pins.
 *
 * Every custom layer until now was pins: rows in `user_pins` that the map fuses into one
 * overlay. That is the right shape for places someone collected, and the wrong shape for the
 * layers the "add source from URL" wizard produces — a WMS flood map, an ArcGIS cadastre, a
 * PMTiles archive. Those have no rows at all. What has to be stored is the manifest the adapter
 * built, so the layer can be rendered again on the next visit without re-probing the service.
 *
 * `source_url` is kept beside the manifest, and not only inside it: it is what the user pasted
 * and what a "refresh this source" would re-probe, and finding it should not mean knowing which
 * of a manifest's several shapes holds a URL for this particular protocol.
 *
 * Also widens the `layer_imports` format check to accept `gpx`. The GPX importer shipped with
 * the format in the SDK union and in the JSON schema, but the constraint here was written when
 * there were three formats, so committing a watch's track would have been rejected by the
 * database after passing every check above it.
 */
export const sourceBackedLayersMigration = defineMigration({
  version: "0013",
  name: "source_backed_layers",
  steps: [
    {
      sql: `ALTER TABLE user_layers ADD COLUMN IF NOT EXISTS source_url TEXT`
    },
    {
      sql: `ALTER TABLE user_layers ADD COLUMN IF NOT EXISTS source_manifest JSONB`
    },
    {
      // The adapter that built the manifest, so a later version of MapOS can tell which layers
      // came from an adapter it has since changed or removed.
      sql: `ALTER TABLE user_layers ADD COLUMN IF NOT EXISTS source_adapter_id TEXT`
    },
    {
      // Either both or neither: a manifest without the URL it came from cannot be refreshed,
      // and a URL without a manifest cannot be drawn.
      sql: `ALTER TABLE user_layers
        DROP CONSTRAINT IF EXISTS user_layers_source_complete`
    },
    {
      sql: `ALTER TABLE user_layers
        ADD CONSTRAINT user_layers_source_complete
        CHECK ((source_url IS NULL) = (source_manifest IS NULL))`
    },
    {
      // Source-backed layers are a small minority of rows, so the index only covers them.
      sql: `CREATE INDEX IF NOT EXISTS user_layers_source_url_idx
        ON user_layers (user_id, source_url)
        WHERE source_url IS NOT NULL`
    },
    {
      sql: `ALTER TABLE layer_imports
        DROP CONSTRAINT IF EXISTS layer_imports_format`
    },
    {
      sql: `ALTER TABLE layer_imports
        ADD CONSTRAINT layer_imports_format
        CHECK (format IN ('mapos-package', 'geojson', 'csv', 'gpx'))`
    }
  ]
});
