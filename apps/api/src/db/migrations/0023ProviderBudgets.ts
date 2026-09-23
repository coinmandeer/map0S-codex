import { defineMigration } from "./migration.js";

export const providerBudgetsMigration = defineMigration({
  version: "0023",
  name: "provider_budgets",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS provider_budget_allocations (
      id UUID PRIMARY KEY, provider TEXT NOT NULL, account TEXT NOT NULL, sku TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL, verification_reference TEXT NOT NULL,
      unit_limit BIGINT NOT NULL CHECK (unit_limit >= 0),
      used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0),
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      CHECK (period_end > period_start),
      UNIQUE (provider, account, sku, period_start)
    )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS provider_budget_active ON provider_budget_allocations
      (provider, account, sku, period_start, period_end) WHERE enabled`
    },
    {
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS provider_budget_one_enabled ON provider_budget_allocations
      (provider, account, sku) WHERE enabled`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS provider_budget_days (
      allocation_id UUID NOT NULL REFERENCES provider_budget_allocations(id), day DATE NOT NULL,
      used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0), PRIMARY KEY (allocation_id, day)
    )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS provider_budget_reservations (
      id UUID PRIMARY KEY, allocation_id UUID NOT NULL REFERENCES provider_budget_allocations(id),
      operation TEXT NOT NULL, units INTEGER NOT NULL CHECK (units > 0),
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
    }
  ]
});
