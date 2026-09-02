import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { commerceMigration } from "../db/migrations/0007_commerce.js";
import {
  anonymizedCommerceIdempotencyKey,
  anonymizedEntitlementSubject,
  entitlementRetentionPlan,
  linkedWalletSubjects,
  ownedEntitlementPredicate,
  retainedEntitlementRedaction
} from "./dataRightsPostgresRepository.js";

function subjectCheck(row: {
  subjectType: string;
  subjectId: string;
  userId: string | null;
}): boolean {
  return row.subjectType === "user"
    ? row.userId !== null && row.subjectId === row.userId
    : row.userId === null;
}

test("retained user entitlements preserve the migration subject/user CHECK", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const plan = entitlementRetentionPlan([
    { id: "ent-user", subjectType: "user" },
    { id: "ent-wallet", subjectType: "wallet" }
  ]);
  assert.deepEqual(plan, {
    allIds: ["ent-user", "ent-wallet"],
    userSubjectIds: ["ent-user"],
    detachedSubjectIds: ["ent-wallet"],
    requiresPseudonymousAccount: true
  });

  const common = retainedEntitlementRedaction(new Date("2026-09-01T12:00:00.000Z"));
  assert.equal(Object.hasOwn(common, "userId"), false);
  assert.equal(Object.hasOwn(common, "subjectId"), false);
  assert.equal(subjectCheck({ subjectType: "user", subjectId: userId, userId }), true);
  // This is the exact shape of the former production bug and must violate 0007 explicitly.
  assert.equal(
    subjectCheck({ subjectType: "user", subjectId: "deleted:old", userId: null }),
    false
  );
  assert.equal(
    subjectCheck({
      subjectType: "wallet",
      subjectId: anonymizedEntitlementSubject("ent-wallet"),
      userId: null
    }),
    true
  );

  const migrationSql = commerceMigration.steps.map((step) => step.sql).join("\n");
  assert.match(
    migrationSql,
    /subject_type = 'user' AND user_id IS NOT NULL AND subject_id = user_id::text/
  );
});

test("wallet entitlement ownership is derived only from linked wallet identities", () => {
  const subjects = linkedWalletSubjects([
    { type: "email", subject: "private@example.test" },
    { type: "wallet", subject: "0x1111111111111111111111111111111111111111" },
    { type: "simulated-wallet", subject: "simulation:fixture" },
    { type: "wallet", subject: "0x1111111111111111111111111111111111111111" }
  ]);
  assert.deepEqual(subjects, ["0x1111111111111111111111111111111111111111", "simulation:fixture"]);

  const ownerId = "00000000-0000-4000-8000-000000000001";
  const compiled = new PgDialect().sqlToQuery(ownedEntitlementPredicate(ownerId, subjects));
  assert.match(compiled.sql, /"subject_type" = \$4/);
  assert.match(compiled.sql, /"subject_id" in \(\$5, \$6\)/);
  assert.deepEqual(compiled.params, [ownerId, "user", ownerId, "wallet", ...subjects]);
  assert.doesNotMatch(JSON.stringify(compiled.params), /private@example\.test/);
});

test("anonymized idempotency keys are fixed-size, domain-separated and collision resistant", () => {
  const orderKeys = new Set<string>();
  const tipKeys = new Set<string>();
  const clientKeyGrammar = /^[A-Za-z0-9._:-]{8,200}$/;
  for (let index = 0; index < 10_000; index += 1) {
    const id = `row:${index}:${"x".repeat(index % 200)}`;
    const order = anonymizedCommerceIdempotencyKey("order", id);
    const tip = anonymizedCommerceIdempotencyKey("tip", id);
    assert.match(order, /^deleted\/order\/[a-f0-9]{64}$/);
    assert.match(tip, /^deleted\/tip\/[a-f0-9]{64}$/);
    assert.ok(order.length >= 8 && order.length <= 200);
    assert.ok(tip.length >= 8 && tip.length <= 200);
    assert.equal(clientKeyGrammar.test(order), false, "reserved deletion namespace became public");
    assert.equal(clientKeyGrammar.test(tip), false, "reserved deletion namespace became public");
    orderKeys.add(order);
    tipKeys.add(tip);
  }
  assert.equal(orderKeys.size, 10_000);
  assert.equal(tipKeys.size, 10_000);
  assert.equal(
    anonymizedCommerceIdempotencyKey("order", "same-row"),
    anonymizedCommerceIdempotencyKey("order", "same-row"),
    "retry must be deterministic"
  );
  assert.notEqual(
    anonymizedCommerceIdempotencyKey("order", "same-row"),
    anonymizedCommerceIdempotencyKey("tip", "same-row")
  );
});
