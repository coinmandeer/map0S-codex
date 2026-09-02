import assert from "node:assert/strict";
import { test } from "node:test";
import { __testing } from "./index.js";
import type { MigrationDatabase } from "./migrations/runner.js";

test("runtime migrations create every table used by the Mapy POI cache", () => {
  const sql = __testing.migrations.join("\n").toLowerCase();
  assert.match(sql, /create table if not exists mapy_pois/);
  assert.match(sql, /create table if not exists mapy_cells/);
  for (const column of ["keyword text not null", "lang text not null", "poi_type text"]) {
    assert.ok(sql.includes(column), `missing Mapy migration column: ${column}`);
  }
  assert.match(sql, /mapy_cells_lookup_idx/);
});

test("runtime migrations carry the full guest and game-progress schema", () => {
  const sql = __testing.migrations.join("\n").toLowerCase();
  for (const column of ["avatar_url", "bio", "home_country", "is_guest", "xp_total"]) {
    assert.match(sql, new RegExp(`users add column if not exists ${column}`));
  }
  assert.match(sql, /create table if not exists game_orb_collections/);
  assert.match(sql, /game_orb_collections_user_idx/);
});

test("runtime migrations include planning, social and namespaced game state", () => {
  const sql = __testing.migrations.join("\n").toLowerCase();
  for (const table of [
    "trip_plans",
    "canonical_places",
    "place_sources",
    "social_follows",
    "social_reviews",
    "social_comments",
    "content_drafts",
    "game_profiles"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
});

test("versioned runner keeps the explicit baseline and ordered additive migrations", () => {
  assert.deepEqual(
    __testing.versionedMigrations.map((migration) => [migration.version, migration.name]),
    [
      ["0001", "baseline_snapshot"],
      ["0002", "spatial_columns"],
      ["0003", "saved_places"],
      ["0004", "canonical_events"],
      ["0005", "linked_identities"],
      ["0006", "layer_imports"],
      ["0007", "commerce_core"],
      ["0008", "rate_limits_and_operations"],
      ["0009", "layer_import_previews"],
      ["0010", "plan_collaboration"]
    ]
  );
  assert.equal(
    __testing.versionedMigrations[0].steps.length,
    __testing.migrations.length,
    "0001 must checksum the complete legacy bootstrap during ledger adoption"
  );
  assert.match(__testing.versionedMigrations[0].steps[0]?.sql ?? "", /CREATE EXTENSION.*postgis/i);
});

test("migration actor and release metadata have stable explicit fallbacks", () => {
  assert.deepEqual(__testing.migrationMetadata({}), {
    actor: "mapos-api",
    release: "unknown-release"
  });
  assert.deepEqual(
    __testing.migrationMetadata({
      MAPOS_MIGRATION_ACTOR: " deploy@vps ",
      MAPOS_RELEASE: " release-2026-09-01 ",
      GIT_SHA: "ignored"
    }),
    { actor: "deploy@vps", release: "release-2026-09-01" }
  );
  assert.deepEqual(__testing.migrationMetadata({ GIT_SHA: "abc123" }), {
    actor: "mapos-api",
    release: "abc123"
  });
});

test("configured initDb path delegates every configured version to the ledger runner", async () => {
  const inspectedVersions: string[] = [];
  const statements: string[] = [];
  const database: MigrationDatabase = {
    async execute(sql, parameters = []) {
      statements.push(sql);
      if (sql.startsWith("SELECT version, name, checksum FROM mapos_schema_migrations")) {
        const version = String(parameters[0]);
        inspectedVersions.push(version);
        const migration = __testing.versionedMigrations.find(
          (candidate) => candidate.version === version
        );
        assert.ok(migration);
        return {
          rows: [{ version, name: migration.name, checksum: migration.checksum }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  await __testing.applyConfiguredMigrations(database, {
    actor: "test-runner",
    release: "test-release"
  });

  assert.deepEqual(inspectedVersions, [
    "0001",
    "0002",
    "0003",
    "0004",
    "0005",
    "0006",
    "0007",
    "0008",
    "0009",
    "0010"
  ]);
  assert.ok(statements.some((statement) => statement.includes("pg_advisory_lock")));
  assert.ok(statements.some((statement) => statement.includes("pg_advisory_unlock")));
});

test("layer import migration is additive, bounded and keeps rollback provenance", () => {
  const migration = __testing.versionedMigrations.find((candidate) => candidate.version === "0006");
  assert.equal(migration?.name, "layer_imports");
  const sql =
    migration?.steps
      .map((step) => step.sql)
      .join("\n")
      .toLowerCase() ?? "";
  assert.match(sql, /create table if not exists layer_imports/);
  assert.match(sql, /preview_id uuid not null/);
  assert.match(sql, /layer_imports_preview_unique/);
  assert.match(sql, /feature_count >= 0 and feature_count <= 1000/);
  assert.match(sql, /status in \('committed', 'rolled-back'\)/);
  assert.match(sql, /layer_id uuid references user_layers\(id\) on delete set null/);
});

test("distributed rate-limit migration stores only bounded HMAC buckets", () => {
  const migration = __testing.versionedMigrations.find((candidate) => candidate.version === "0008");
  assert.equal(migration?.name, "rate_limits_and_operations");
  const sql =
    migration?.steps
      .map((step) => step.sql)
      .join("\n")
      .toLowerCase() ?? "";
  assert.match(sql, /create table if not exists rate_limit_windows/);
  assert.match(sql, /bucket_hash char\(64\)/);
  assert.match(sql, /primary key \(bucket_hash, window_start_ms\)/);
  assert.match(sql, /rate_limit_windows_expiry_idx/);
  assert.doesNotMatch(sql, /ip_address|remote_address|user_agent/);
});
