import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { userPins } from "../schema.js";
import { pinPathsMigration } from "./0011PinPaths.js";

test("0011 gives a route pin its line without disturbing existing point pins", () => {
  assert.equal(pinPathsMigration.version, "0011");
  assert.equal(pinPathsMigration.name, "pin_paths");
  assert.match(pinPathsMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = pinPathsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /alter table user_pins/);
  assert.match(sql, /add column if not exists path jsonb/);
  // Nullable and additive: every pin written before this migration stays valid.
  assert.match(sql, /path is null/);
  // A line needs two points; one would store something that cannot be drawn.
  assert.match(sql, /jsonb_array_length\(path\) >= 2/);
  assert.doesNotMatch(sql, /not null/, "the column must not be required");
});

test("the drizzle schema exposes path as an optional column on user_pins", () => {
  const column = getTableConfig(userPins).columns.find((entry) => entry.name === "path");
  assert.ok(column, "user_pins.path is declared");
  assert.equal(column.notNull, false);
  assert.equal(column.columnType, "PgJsonb");
});
