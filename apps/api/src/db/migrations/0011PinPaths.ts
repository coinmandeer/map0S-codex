import { defineMigration } from "./migration.js";

/**
 * A pin of kind `route` — a GPX track, a saved plan — is a line, not a point. Its shape lives in
 * its own column rather than inside `properties` because `properties` is the pin's user-facing
 * extension data, shown field by field in the detail sheet; geometry is not one of those fields
 * and would render as an unreadable wall of numbers. `lng`/`lat` stay populated as the anchor so
 * every existing bbox filter, cluster and list keeps treating a route as one findable place.
 */
export const pinPathsMigration = defineMigration({
  version: "0011",
  name: "pin_paths",
  steps: [
    {
      // The check bounds the array shape but not its length: the 2000-point cap belongs to the
      // importer, where it can be reported to the user, not to a constraint that would reject a
      // legitimate write with an opaque database error.
      sql: `ALTER TABLE user_pins
        ADD COLUMN IF NOT EXISTS path JSONB
        CONSTRAINT user_pins_path_is_line CHECK (
          path IS NULL
          OR (jsonb_typeof(path) = 'array' AND jsonb_array_length(path) >= 2)
        )`
    }
  ]
});
