import assert from "node:assert/strict";
import test from "node:test";
import { defineMigration } from "./migration.js";
import {
  MIGRATION_LEDGER_TABLE,
  runVersionedMigrations,
  type MigrationDatabase,
  type MigrationParameter,
  type MigrationQueryResult
} from "./runner.js";

interface AppliedRow extends Record<string, unknown> {
  version: string;
  name: string;
  checksum: string;
}

class FakeMigrationDatabase implements MigrationDatabase {
  readonly calls: Array<{ sql: string; parameters: MigrationParameter[] }> = [];
  readonly applied = new Map<string, AppliedRow>();
  readonly indexes = new Map<string, { indisvalid: boolean; definition: string }>();
  readonly rowCounts = new Map<string, number[]>();
  failOnceOn: string | null = null;

  async execute(sql: string, parameters: MigrationParameter[] = []): Promise<MigrationQueryResult> {
    this.calls.push({ sql, parameters });
    if (this.failOnceOn && sql.includes(this.failOnceOn)) {
      this.failOnceOn = null;
      throw new Error("simulated migration interruption");
    }
    if (sql.startsWith(`SELECT version, name, checksum FROM ${MIGRATION_LEDGER_TABLE}`)) {
      const row = this.applied.get(String(parameters[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`INSERT INTO ${MIGRATION_LEDGER_TABLE}`)) {
      const [version, name, checksum] = parameters.map(String);
      this.applied.set(version!, { version: version!, name: name!, checksum: checksum! });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM pg_index AS idx")) {
      const index = this.indexes.get(String(parameters[0]));
      return { rows: index ? [index] : [], rowCount: index ? 1 : 0 };
    }
    if (sql.startsWith("DROP INDEX CONCURRENTLY IF EXISTS ")) {
      this.indexes.delete(sql.split(" ").at(-1)!);
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("CREATE INDEX CONCURRENTLY IF NOT EXISTS ")) {
      const name = /CREATE INDEX CONCURRENTLY IF NOT EXISTS ([a-z0-9_]+)/.exec(sql)?.[1];
      assert.ok(name);
      this.indexes.set(name, {
        indisvalid: true,
        definition: sql.replace("CONCURRENTLY IF NOT EXISTS ", "")
      });
      return { rows: [], rowCount: 0 };
    }
    const counts = this.rowCounts.get(sql);
    return { rows: [], rowCount: counts?.shift() ?? 0 };
  }
}

const metadata = { actor: "test-runner", release: "test-release" };

test("runner applies each immutable version once and records its checksum", async () => {
  const database = new FakeMigrationDatabase();
  const migration = defineMigration({
    version: "0001",
    name: "baseline_snapshot",
    steps: [{ sql: "CREATE EXTENSION IF NOT EXISTS postgis" }]
  });
  const ticks = [100, 127];

  await runVersionedMigrations(database, [migration], metadata, () => ticks.shift() ?? 127);
  await runVersionedMigrations(database, [migration], metadata);

  assert.equal(
    database.calls.filter((call) => call.sql === "CREATE EXTENSION IF NOT EXISTS postgis").length,
    1
  );
  assert.deepEqual(database.applied.get("0001"), {
    version: "0001",
    name: "baseline_snapshot",
    checksum: migration.checksum
  });
  const ledgerInsert = database.calls.find((call) =>
    call.sql.startsWith(`INSERT INTO ${MIGRATION_LEDGER_TABLE}`)
  );
  assert.deepEqual(ledgerInsert?.parameters.slice(3), [27, "test-runner", "test-release"]);
});

test("runner refuses edited history and always releases its advisory lock", async () => {
  const database = new FakeMigrationDatabase();
  const migration = defineMigration({
    version: "0001",
    name: "baseline_snapshot",
    steps: [{ sql: "SELECT 1" }]
  });
  database.applied.set("0001", {
    version: "0001",
    name: "baseline_snapshot",
    checksum: "0".repeat(64)
  });

  await assert.rejects(
    runVersionedMigrations(database, [migration], metadata),
    /checksum mismatch/
  );
  assert.ok(database.calls.some((call) => call.sql.includes("pg_advisory_unlock")));
});

test("bounded backfills repeat to zero rows and partial failures do not enter the ledger", async () => {
  const database = new FakeMigrationDatabase();
  const migration = defineMigration({
    version: "0002",
    name: "spatial_columns",
    steps: [{ sql: "BATCHED BACKFILL", repeatUntilNoRows: true, maxBatches: 5 }]
  });
  database.rowCounts.set("BATCHED BACKFILL", [3, 1, 0]);

  await runVersionedMigrations(database, [migration], metadata);
  assert.equal(database.calls.filter((call) => call.sql === "BATCHED BACKFILL").length, 3);
  assert.ok(database.applied.has("0002"));

  const retryDatabase = new FakeMigrationDatabase();
  retryDatabase.failOnceOn = "SAFE ADD COLUMN";
  const retryMigration = defineMigration({
    version: "0003",
    name: "retryable_addition",
    steps: [{ sql: "SAFE ADD COLUMN" }]
  });
  await assert.rejects(runVersionedMigrations(retryDatabase, [retryMigration], metadata));
  assert.equal(retryDatabase.applied.has("0003"), false);
  await runVersionedMigrations(retryDatabase, [retryMigration], metadata);
  assert.ok(retryDatabase.applied.has("0003"));
});

test("runner repairs an interrupted invalid concurrent index but never replaces a valid mismatch", async () => {
  const migration = defineMigration({
    version: "0002",
    name: "spatial_columns",
    steps: [
      {
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS demo_geog_gist ON demo USING GIST (geog)",
        concurrentIndex: {
          name: "demo_geog_gist",
          expectedDefinitionFragments: ["demo using gist (geog)"]
        }
      }
    ]
  });
  const interrupted = new FakeMigrationDatabase();
  interrupted.indexes.set("demo_geog_gist", {
    indisvalid: false,
    definition: "CREATE INDEX demo_geog_gist ON public.demo USING gist (geog)"
  });

  await runVersionedMigrations(interrupted, [migration], metadata);
  assert.ok(
    interrupted.calls.some(
      (call) => call.sql === "DROP INDEX CONCURRENTLY IF EXISTS demo_geog_gist"
    )
  );
  assert.equal(interrupted.indexes.get("demo_geog_gist")?.indisvalid, true);

  const mismatched = new FakeMigrationDatabase();
  mismatched.indexes.set("demo_geog_gist", {
    indisvalid: true,
    definition: "CREATE INDEX demo_geog_gist ON public.other_table USING gist (geog)"
  });
  await assert.rejects(
    runVersionedMigrations(mismatched, [migration], metadata),
    /unexpected definition/
  );
  assert.ok(mismatched.indexes.has("demo_geog_gist"));
  assert.equal(mismatched.applied.has("0002"), false);
});
