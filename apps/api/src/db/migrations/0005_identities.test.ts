import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { identityAuditEvents, identityChallenges, userIdentities } from "../schema.js";
import { identitiesMigration } from "./0005_identities.js";

test("0005 linked-identity migration is additive, replay-safe and audit scoped", () => {
  assert.equal(identitiesMigration.version, "0005");
  assert.equal(identitiesMigration.name, "linked_identities");
  assert.match(identitiesMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = identitiesMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  assert.match(sql, /create table if not exists user_identities/);
  assert.match(sql, /unique \(type, provider, subject\)/);
  assert.match(sql, /create table if not exists identity_challenges/);
  assert.match(sql, /insert into user_identities/);
  assert.match(sql, /where is_guest = 0/);
  assert.match(sql, /case-insensitive duplicate user emails/);
  assert.match(sql, /verified_at, created_at/);
  assert.match(sql, /nonce text not null unique/);
  assert.match(sql, /session_id text not null references sessions/);
  assert.match(sql, /create table if not exists identity_audit_events/);
  assert.doesNotMatch(sql, /signature/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)/);
  assert.doesNotMatch(sql, /delete\s+from/);
  assert.doesNotMatch(sql, /alter\s+table/);
});

test("Drizzle identity schema mirrors uniqueness, expiry and owner indexes", () => {
  const identities = getTableConfig(userIdentities);
  const challenges = getTableConfig(identityChallenges);
  const audits = getTableConfig(identityAuditEvents);
  assert.ok(
    identities.indexes.some(
      (index) => index.config.name === "user_identities_subject_unique" && index.config.unique
    )
  );
  assert.ok(
    challenges.indexes.some(
      (index) => index.config.name === "identity_challenges_nonce_unique" && index.config.unique
    )
  );
  assert.ok(
    challenges.indexes.some((index) => index.config.name === "identity_challenges_owner_idx")
  );
  assert.ok(audits.indexes.some((index) => index.config.name === "identity_audit_events_user_idx"));
  assert.equal(
    challenges.columns.some((column) => column.name === "signature"),
    false
  );
});
