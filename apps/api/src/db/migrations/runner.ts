import type { Migration, MigrationStep } from "./migration.js";

export const MIGRATION_LEDGER_TABLE = "mapos_schema_migrations";
const MIGRATION_LOCK_KEY = "mapos:db:migrations:v1";

export const CREATE_MIGRATION_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  actor TEXT NOT NULL,
  release TEXT NOT NULL
)`;

export type MigrationParameter = string | number;

export interface MigrationQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/** The adapter is intentionally tiny so the runner can be tested without a database process. */
export interface MigrationDatabase {
  execute(sql: string, parameters?: MigrationParameter[]): Promise<MigrationQueryResult>;
}

export interface MigrationMetadata {
  actor: string;
  release: string;
}

function validateManifest(migrations: readonly Migration[]) {
  const versions = migrations.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length) throw new Error("Duplicate migration version");
  const sorted = [...versions].sort();
  if (versions.some((version, index) => version !== sorted[index])) {
    throw new Error("Migrations must be ordered by version");
  }
}

async function runStep(database: MigrationDatabase, migration: Migration, step: MigrationStep) {
  if (step.concurrentIndex) {
    const { name, expectedDefinitionFragments } = step.concurrentIndex;
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe migration index name: ${name}`);
    const inspect = async () =>
      database.execute(
        `SELECT idx.indisvalid, pg_get_indexdef(idx.indexrelid) AS definition
         FROM pg_index AS idx
         JOIN pg_class AS cls ON cls.oid = idx.indexrelid
         JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
         WHERE ns.nspname = current_schema() AND cls.relname = $1`,
        [name]
      );
    const isExpected = (row: Record<string, unknown>) => {
      const definition = String(row.definition ?? "").toLowerCase();
      return (
        row.indisvalid === true &&
        expectedDefinitionFragments.every((fragment) => definition.includes(fragment.toLowerCase()))
      );
    };

    const before = (await inspect()).rows[0];
    if (before && isExpected(before)) return;
    if (before?.indisvalid === true) {
      throw new Error(`Index ${name} exists with an unexpected definition; refusing to replace it`);
    }
    if (before) await database.execute(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);

    await database.execute(step.sql);
    const after = (await inspect()).rows[0];
    if (!after || !isExpected(after)) {
      throw new Error(
        `Concurrent index ${name} was not created with the expected valid definition`
      );
    }
    return;
  }

  const maxBatches = step.maxBatches ?? 100_000;
  for (let batches = 0; batches < maxBatches; batches += 1) {
    const result = await database.execute(step.sql);
    if (!step.repeatUntilNoRows || result.rowCount === 0) return;
  }
  throw new Error(
    `Migration ${migration.version}_${migration.name} exceeded ${maxBatches} backfill batches`
  );
}

export async function runVersionedMigrations(
  database: MigrationDatabase,
  migrations: readonly Migration[],
  metadata: MigrationMetadata,
  now: () => number = () => performance.now()
) {
  validateManifest(migrations);
  if (!metadata.actor.trim() || !metadata.release.trim()) {
    throw new Error("Migration actor and release metadata are required");
  }

  await database.execute(CREATE_MIGRATION_LEDGER_SQL);
  await database.execute("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
  try {
    for (const migration of migrations) {
      const applied = await database.execute(
        `SELECT version, name, checksum FROM ${MIGRATION_LEDGER_TABLE} WHERE version = $1`,
        [migration.version]
      );
      const existing = applied.rows[0];
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Applied migration ${migration.version} checksum mismatch; add a new migration instead of editing history`
          );
        }
        continue;
      }

      const startedAt = now();
      for (const step of migration.steps) await runStep(database, migration, step);
      const durationMs = Math.max(0, Math.round(now() - startedAt));
      await database.execute(
        `INSERT INTO ${MIGRATION_LEDGER_TABLE}
          (version, name, checksum, duration_ms, actor, release)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          migration.version,
          migration.name,
          migration.checksum,
          durationMs,
          metadata.actor,
          metadata.release
        ]
      );
    }
  } finally {
    await database.execute("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY]);
  }
}
