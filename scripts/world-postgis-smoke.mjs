import { execFileSync } from "node:child_process";
import postgres from "postgres";
import assert from "node:assert/strict";
const env = JSON.parse(
  execFileSync("docker", ["inspect", "infra-postgres-1", "--format", "{{json .Config.Env}}"], {
    encoding: "utf8"
  })
);
const value = (name) => env.find((e) => e.startsWith(name + "="))?.slice(name.length + 1);
const options = {
  host: "127.0.0.1",
  port: 5434,
  username: value("POSTGRES_USER"),
  password: value("POSTGRES_PASSWORD"),
  database: value("POSTGRES_DB") ?? value("POSTGRES_USER"),
  max: 1
};
const admin = postgres(options);
const database = "mapos_world_validation_" + Date.now();
await admin.unsafe(`CREATE DATABASE ${database}`);
process.env.DATABASE_URL = `postgres://${encodeURIComponent(options.username)}:${encodeURIComponent(options.password)}@127.0.0.1:5434/${database}`;
let sql;
try {
  ({ sql } = await import("../apps/api/src/db/index.ts"));
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  await sql`CREATE TABLE users(id uuid PRIMARY KEY,xp_total integer NOT NULL DEFAULT 0)`;
  const { gameWorldMigration } = await import("../apps/api/src/db/migrations/0021GameWorld.ts");
  for (const step of gameWorldMigration.steps) await sql.unsafe(step.sql);
  const { PostgresWorldRepository } = await import("../apps/api/src/world/postgresRepository.ts");
  const repo = new PostgresWorldRepository();
  const uid = "33e19537-2073-4f1c-8bfe-36ecc5d690b2";
  await sql`INSERT INTO users(id,xp_total) VALUES(${uid},75)`;
  await repo.transaction(async (tx) => {
    await tx.put("threads", { id: "here", userId: uid, lng: 14.425, lat: 50.085, createdAt: 2 });
    await tx.put("threads", { id: "far", userId: uid, lng: 14.425, lat: 50.09, createdAt: 1 });
    await tx.put("rewards", { id: "once", userId: uid, mode: "gps", xp: 10 });
  });
  assert.equal(
    (await repo.list("threads", { area: { lng: 14.425, lat: 50.085, radius: 100 } })).length,
    1
  );
  assert.equal(
    (await repo.list("threads", { area: { lng: 14.425, lat: 50.085, radius: 1000 } })).length,
    2
  );
  assert.equal((await repo.list("threads", { bbox: [14.424, 50.084, 14.426, 50.086] })).length, 1);
  await assert.rejects(
    repo.transaction(async (tx) => {
      await tx.put("rewards", { id: "rollback", userId: uid, mode: "gps", xp: 100 });
      throw new Error("rollback");
    })
  );
  assert.equal((await sql`SELECT xp_total FROM users WHERE id=${uid}`)[0].xp_total, 85);
  assert.equal(await repo.get("rewards", "rollback"), null);
  console.log("PostGIS: migration, metres, viewport, reward transaction and rollback passed.");
} finally {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE ${database}`);
  await admin.end();
}
