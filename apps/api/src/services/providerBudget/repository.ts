import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { sql } from "../../db/index.js";
import { budgetPolicy, ProviderBudgetError, type BudgetProduct } from "./policy.js";

export interface BudgetRequest {
  product: BudgetProduct;
  account: string;
  operation: string;
  units?: number;
}
/** Single row lock serializes all reservations for one account/SKU, including daily counters. */
export function createProviderBudgetRepository(
  database: postgres.Sql,
  providerManaged = () => process.env.MAPOS_AI_BUDGET_MODE === "provider"
) {
  return {
    /** Read-only hint for honest UI phases. Dispatch still requires an atomic reservation. */
    async available(input: BudgetRequest): Promise<boolean> {
      const policy = budgetPolicy(input.product, input.operation, input.units ?? 1);
      if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(input.account)) return false;
      if (policy.provider === "ollama" && providerManaged()) return true;
      try {
        const rows =
          await database`SELECT unit_limit,used FROM provider_budget_allocations WHERE provider=${policy.provider} AND account=${input.account} AND sku=${policy.sku}
          AND enabled AND verified_at<=NOW() AND verification_reference<>'' AND period_start<=NOW() AND period_end>NOW()`;
        return (
          rows.length === 1 &&
          Number(rows[0]!.used) + (input.units ?? 1) <=
            Math.min(Number(rows[0]!.unit_limit), policy.monthly)
        );
      } catch {
        return false;
      }
    },
    async reserve(input: BudgetRequest, signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted();
      const units = input.units ?? 1;
      const policy = budgetPolicy(input.product, input.operation, units);
      if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(input.account))
        throw new ProviderBudgetError("budget-disabled");
      // Explicit deployment-owner choice: the cloud account enforces billing limits.
      // Keep operation allowlists and per-run limits; never fabricate a verified free allocation.
      if (policy.provider === "ollama" && providerManaged())
        return `provider-managed:${randomUUID()}`;
      try {
        return await database.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout = '3000ms'`;
          await tx`SET LOCAL lock_timeout = '2000ms'`;
          signal?.throwIfAborted();
          // Use DB time, not clocks on individual API instances. Multiple overlapping grants fail closed.
          const rows = await tx`SELECT id, unit_limit, used FROM provider_budget_allocations
            WHERE provider = ${policy.provider} AND account = ${input.account} AND sku = ${policy.sku}
              AND enabled AND verified_at <= NOW() AND verification_reference <> ''
              AND period_start <= NOW() AND period_end > NOW()
            ORDER BY period_start FOR UPDATE`;
          if (rows.length !== 1) throw new ProviderBudgetError("budget-disabled");
          const allocation = rows[0]!;
          if (
            Number(allocation.used) + units >
            Math.min(Number(allocation.unit_limit), policy.monthly)
          ) {
            throw new ProviderBudgetError("budget-exhausted");
          }
          if (policy.daily !== null) {
            const days = await tx`INSERT INTO provider_budget_days (allocation_id, day, used)
              VALUES (${allocation.id}, (NOW() AT TIME ZONE 'UTC')::date, ${units})
              ON CONFLICT (allocation_id, day) DO UPDATE SET used = provider_budget_days.used + ${units}
              WHERE provider_budget_days.used + ${units} <= ${policy.daily} RETURNING used`;
            if (!days.length || Number(days[0]!.used) > policy.daily)
              throw new ProviderBudgetError("budget-exhausted");
          }
          signal?.throwIfAborted();
          await tx`UPDATE provider_budget_allocations SET used = used + ${units} WHERE id = ${allocation.id}`;
          const id = randomUUID();
          await tx`INSERT INTO provider_budget_reservations (id, allocation_id, operation, units)
            VALUES (${id}, ${allocation.id}, ${input.operation}, ${units})`;
          return id;
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ProviderBudgetError) throw error;
        // No fallback to process memory, no database errors/connection strings in public responses.
        throw new ProviderBudgetError("budget-unavailable");
      }
    }
  };
}
export const providerBudgets = createProviderBudgetRepository(sql);
