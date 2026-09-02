import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { planDiscussionThreads, planShareLinks } from "../schema.js";
import { planCollaborationMigration } from "./0010PlanCollaboration.js";

test("0010 stores revocable hashed plan links and bounded owner-scoped discussion threads", () => {
  assert.equal(planCollaborationMigration.version, "0010");
  assert.equal(planCollaborationMigration.name, "plan_collaboration");
  const sql = planCollaborationMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists plan_share_links/);
  assert.match(sql, /token_hash char\(64\).*unique/);
  assert.match(sql, /permission = 'view'/);
  assert.match(sql, /revoked_at timestamptz/);
  assert.match(sql, /create table if not exists plan_discussion_threads/);
  assert.match(sql, /message_count between 0 and 40/);
  assert.match(sql, /octet_length\(messages::text\) <= 262144/);
  assert.match(sql, /on delete cascade/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)|delete\s+from/);
});

test("Drizzle schema mirrors hashed shares, bounded messages and owner/plan indexes", () => {
  const shares = getTableConfig(planShareLinks);
  assert.equal(shares.name, "plan_share_links");
  assert.deepEqual(shares.indexes.map((index) => index.config.name).sort(), [
    "plan_share_links_owner_plan_idx",
    "plan_share_links_token_unique"
  ]);
  assert.equal(shares.foreignKeys.filter((key) => key.onDelete === "cascade").length, 2);
  assert.deepEqual(shares.checks.map((check) => check.name).sort(), [
    "plan_share_links_permission",
    "plan_share_links_token_hash"
  ]);

  const discussions = getTableConfig(planDiscussionThreads);
  assert.equal(discussions.name, "plan_discussion_threads");
  assert.deepEqual(
    discussions.indexes.map((index) => index.config.name),
    ["plan_discussion_threads_owner_plan_idx"]
  );
  assert.equal(discussions.foreignKeys.filter((key) => key.onDelete === "cascade").length, 2);
  assert.deepEqual(discussions.checks.map((check) => check.name).sort(), [
    "plan_discussion_threads_message_count",
    "plan_discussion_threads_messages",
    "plan_discussion_threads_revision"
  ]);
});
