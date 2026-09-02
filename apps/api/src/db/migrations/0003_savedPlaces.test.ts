import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { savedPlaceCollections, savedPlaces } from "../schema.js";
import { savedPlacesMigration } from "./0003_savedPlaces.js";

test("0003 saved-places migration is additive, immutable and owner scoped", () => {
  assert.equal(savedPlacesMigration.version, "0003");
  assert.equal(savedPlacesMigration.name, "saved_places");
  assert.match(savedPlacesMigration.checksum, /^[a-f0-9]{64}$/);

  const sql = savedPlacesMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists saved_place_collections/);
  assert.match(sql, /create table if not exists saved_places/);
  assert.match(
    sql,
    /num_nonnulls\(canonical_place_id, user_pin_id, external_feature_ref, embedded_snapshot\) = 1/
  );
  assert.match(sql, /saved_places_snapshot_policy/);
  assert.match(sql, /saved_places_snapshot_bounds/);
  assert.match(sql, /octet_length\(source_snapshot::text\) <= 32768/);
  assert.match(sql, /foreign key \(user_id, collection_id\)/);
  assert.match(sql, /references saved_place_collections \(user_id, id\)/);
  assert.match(sql, /jsonb_array_length\(tags\) <= 24/);
  assert.match(sql, /octet_length\(tags::text\) <= 4096/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)/);
  assert.doesNotMatch(sql, /delete\s+from/);
  assert.doesNotMatch(sql, /alter\s+table/);
});

test("Drizzle saved-place schema mirrors target, snapshot, ACL and query indexes", () => {
  const place = getTableConfig(savedPlaces);
  const collection = getTableConfig(savedPlaceCollections);

  for (const column of [
    "canonical_place_id",
    "user_pin_id",
    "external_feature_ref",
    "embedded_snapshot",
    "source_snapshot",
    "category",
    "note",
    "tags",
    "collection_id",
    "sort_order"
  ]) {
    assert.ok(
      place.columns.some((candidate) => candidate.name === column),
      `missing ${column}`
    );
  }
  assert.equal(place.columns.find((column) => column.name === "tags")?.notNull, true);
  assert.equal(place.columns.find((column) => column.name === "category")?.notNull, true);
  assert.ok(place.checks.some((check) => check.name === "saved_places_exactly_one_target"));
  assert.ok(place.checks.some((check) => check.name === "saved_places_snapshot_policy"));
  assert.ok(place.checks.some((check) => check.name === "saved_places_snapshot_bounds"));
  assert.ok(
    place.foreignKeys.some(
      (foreignKey) => foreignKey.getName() === "saved_places_collection_owner_fk"
    )
  );
  for (const index of [
    "saved_places_user_cursor_idx",
    "saved_places_user_category_idx",
    "saved_places_user_collection_idx"
  ]) {
    assert.ok(
      place.indexes.some((candidate) => candidate.config.name === index),
      `missing ${index}`
    );
  }
  assert.ok(
    collection.indexes.some(
      (candidate) => candidate.config.name === "saved_place_collections_user_id_unique"
    )
  );
});
