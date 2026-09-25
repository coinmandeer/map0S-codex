import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { questAnchorSweeps, questAnchors } from "../schema.js";
import { questAnchorsMigration } from "./0012QuestAnchors.js";

test("0012 stores quest anchors with a spatial index and a sweep log", () => {
  assert.equal(questAnchorsMigration.version, "0012");
  assert.equal(questAnchorsMigration.name, "quest_anchors");
  assert.match(questAnchorsMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = questAnchorsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists quest_anchors/);
  assert.match(sql, /ref text primary key/, "the source's own ref is the identity");
  assert.match(sql, /refreshed_at timestamptz not null/, "staleness must be recordable");
  assert.match(sql, /lng double precision not null check \(lng between -180 and 180\)/);
  assert.match(sql, /using gist \(geog\)/, "the bbox read has to be index-assisted");
  // Remembering that an area is empty is what stops it being re-fetched forever.
  assert.match(sql, /create table if not exists quest_anchor_sweeps/);
  assert.match(sql, /primary key \(source_id, cell\)/);
});

test("the concurrent index is declared so an interrupted build can be repaired", () => {
  const concurrent = questAnchorsMigration.steps.find((step) => step.concurrentIndex);
  assert.ok(concurrent, "the GiST index is built concurrently, as in migration 0002");
  assert.equal(concurrent.concurrentIndex?.name, "quest_anchors_geog_gist");
  assert.match(concurrent.sql, /CONCURRENTLY/);
});

test("the drizzle tables match the migration", () => {
  const anchors = getTableConfig(questAnchors);
  assert.equal(anchors.name, "quest_anchors");
  const columns = new Set(anchors.columns.map((column) => column.name));
  for (const expected of ["ref", "source_id", "name", "category", "geog", "refreshed_at"]) {
    assert.ok(columns.has(expected), `quest_anchors.${expected} is declared`);
  }
  assert.equal(getTableConfig(questAnchorSweeps).name, "quest_anchor_sweeps");
});
