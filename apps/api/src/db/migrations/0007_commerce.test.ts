import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  commerceEntitlements,
  commerceLedgerEntries,
  commerceOffers,
  commerceOrders,
  commercePaymentEvents,
  commerceProducts,
  commerceReconciliationRuns,
  commerceReferrals,
  commerceSubscriptions,
  commerceTips,
  commerceUseCases
} from "../schema.js";
import { commerceMigration } from "./0007_commerce.js";

const TABLES = [
  "commerce_use_cases",
  "commerce_products",
  "commerce_offers",
  "commerce_orders",
  "commerce_subscriptions",
  "commerce_entitlements",
  "commerce_referrals",
  "commerce_tips",
  "commerce_payment_events",
  "commerce_ledger_entries",
  "commerce_reconciliation_runs"
];

test("0007 commerce migration is additive, bounded and makes provider events idempotent", () => {
  assert.equal(commerceMigration.version, "0007");
  assert.equal(commerceMigration.name, "commerce_core");
  assert.match(commerceMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = commerceMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /unique \(provider, provider_event_id\)/);
  assert.match(sql, /signature_verified boolean not null check \(signature_verified\)/);
  assert.match(sql, /operation_key text not null unique/);
  assert.match(sql, /octet_length\(payload::text\) <= 131072/);
  assert.doesNotMatch(sql, /card_number|card_token|private_key|seed_phrase/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)|delete\s+from/);
});

test("Drizzle schema mirrors every commerce aggregate and ledger table", () => {
  const configs = [
    commerceUseCases,
    commerceProducts,
    commerceOffers,
    commerceOrders,
    commerceSubscriptions,
    commerceEntitlements,
    commerceReferrals,
    commerceTips,
    commercePaymentEvents,
    commerceLedgerEntries,
    commerceReconciliationRuns
  ].map(getTableConfig);
  assert.deepEqual(
    configs.map((config) => config.name),
    TABLES
  );
  assert.ok(
    configs[8]!.indexes.some(
      (index) => index.config.name === "commerce_payment_events_provider_event_unique"
    )
  );
  assert.ok(
    configs[9]!.indexes.some((index) => index.config.name === "commerce_ledger_operation_unique")
  );
  assert.ok(
    configs[5]!.checks.some((check) => check.name === "commerce_entitlements_subject_scope")
  );
});
