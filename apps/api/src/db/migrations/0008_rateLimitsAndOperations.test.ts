import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitsAndOperationsMigration } from "./0008_rateLimitsAndOperations.js";

test("0008 adds only bounded hashed rate windows and an expiry index", () => {
  assert.equal(rateLimitsAndOperationsMigration.version, "0008");
  const sql = rateLimitsAndOperationsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists rate_limit_windows/);
  assert.match(sql, /bucket_hash char\(64\)/);
  assert.match(sql, /primary key \(bucket_hash, window_start_ms\)/);
  assert.match(sql, /rate_limit_windows_expiry_idx/);
  assert.doesNotMatch(sql, /ip_address|request_url|query|prompt|email/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)/);
});
