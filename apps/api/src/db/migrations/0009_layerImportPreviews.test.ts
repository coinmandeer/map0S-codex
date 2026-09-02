import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { layerImportPreviews } from "../schema.js";
import { layerImportPreviewsMigration } from "./0009_layerImportPreviews.js";

test("0009 adds an owner-bound, expiring and size-bounded preview store", () => {
  assert.equal(layerImportPreviewsMigration.version, "0009");
  assert.equal(layerImportPreviewsMigration.name, "layer_import_previews");
  assert.match(layerImportPreviewsMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = layerImportPreviewsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists layer_import_previews/);
  assert.match(sql, /user_id uuid not null references users\(id\) on delete cascade/);
  assert.match(sql, /package_digest char\(64\)/);
  assert.match(sql, /parsed jsonb not null/);
  assert.match(sql, /octet_length\(parsed::text\) <= 8388608/);
  assert.match(sql, /expires_at timestamptz not null check \(expires_at > created_at\)/);
  assert.match(sql, /layer_import_previews_owner_created_idx/);
  assert.match(sql, /layer_import_previews_expiry_idx/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)|delete\s+from/);
});

test("Drizzle schema mirrors preview ownership, expiry and indexes", () => {
  const config = getTableConfig(layerImportPreviews);
  assert.equal(config.name, "layer_import_previews");
  assert.deepEqual(config.indexes.map((index) => index.config.name).sort(), [
    "layer_import_previews_expiry_idx",
    "layer_import_previews_owner_created_idx"
  ]);
  assert.ok(config.foreignKeys.some((foreignKey) => foreignKey.onDelete === "cascade"));
  assert.deepEqual(config.checks.map((check) => check.name).sort(), [
    "layer_import_previews_digest",
    "layer_import_previews_expiry",
    "layer_import_previews_parsed_size"
  ]);
});
