/** Operator-only CLI. Never called by the public API or at application startup. */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { sql } from "../../db/index.js";
import { PRODUCTS, type BudgetProduct } from "./policy.js";
async function main() {
  const { values } = parseArgs({
    options: {
      product: { type: "string" },
      account: { type: "string" },
      units: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      reference: { type: "string" },
      "verified-free-allocation": { type: "boolean", default: false }
    }
  });
  const product = values.product as BudgetProduct,
    policy = PRODUCTS[product];
  const units = Number(values.units),
    start = Date.parse(values.start ?? ""),
    end = Date.parse(values.end ?? "");
  if (
    !policy ||
    policy.monthly === 0 ||
    !values["verified-free-allocation"] ||
    !/^[a-zA-Z0-9._:-]{1,120}$/.test(values.account ?? "") ||
    !values.reference?.trim() ||
    values.reference.length > 200 ||
    !Number.isSafeInteger(units) ||
    units < 0 ||
    units > policy.monthly ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > Date.now() ||
    end <= Date.now() ||
    end - start < 27 * 86400000 ||
    end - start > 32 * 86400000
  ) {
    throw new Error(
      "Required: known --product, --account, --units within policy, actual billing --start/--end (ISO), non-secret --reference, --verified-free-allocation. No grant was created."
    );
  }
  const id = randomUUID();
  await sql.begin(async (tx) => {
    // Never replace a current grant or clear its consumed units. Re-running the same period fails.
    await tx`UPDATE provider_budget_allocations SET enabled = FALSE
      WHERE provider = ${policy.provider} AND account = ${values.account!} AND sku = ${policy.sku} AND period_end <= NOW()`;
    await tx`INSERT INTO provider_budget_allocations
      (id,provider,account,sku,period_start,period_end,verified_at,verification_reference,unit_limit,enabled)
      VALUES (${id},${policy.provider},${values.account!},${policy.sku},${new Date(start).toISOString()},${new Date(end).toISOString()},NOW(),${values.reference!.trim()},${units},TRUE)`;
  });
  console.log(
    JSON.stringify({ allocationId: id, product, units, expiresAt: new Date(end).toISOString() })
  );
}
main()
  .catch(() => {
    console.error(
      "Budget allocation rejected. Check arguments, existing grant and database availability; no quota reset was performed."
    );
    process.exitCode = 1;
  })
  .finally(() => sql.end());
