import assert from "node:assert/strict";
import test from "node:test";
import { gameWorldMigration } from "./0021GameWorld.js";
import { worldLookupIndexesMigration } from "./0022WorldLookupIndexes.js";

test("published world migration retains the checksum verified on the VPS", () => {
  assert.equal(
    gameWorldMigration.checksum,
    "fb7d8ce28cd3ed1fa888709b652d9b4f20c95fd4721f291b8e31ae6bd31e863d"
  );
});

test("world lookup indexes are an additive independently versioned migration", () => {
  assert.equal(worldLookupIndexesMigration.version, "0022");
  assert.equal(worldLookupIndexesMigration.steps.length, 36);
  const names = new Set<string>();
  for (const { sql } of worldLookupIndexesMigration.steps) {
    assert.match(sql, /^CREATE INDEX IF NOT EXISTS world_\w+ ON world_\w+/);
    names.add(sql.match(/EXISTS (\w+)/)![1]);
  }
  assert.equal(names.size, 36);
});
