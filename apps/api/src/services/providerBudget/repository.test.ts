import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { providerBudgetsMigration } from "../../db/migrations/0023ProviderBudgets.js";
import { createProviderBudgetRepository } from "./repository.js";
import { budgetPolicy, ProviderBudgetError } from "./policy.js";

test("disabled products, invalid operations and invalid units cannot reserve", () => {
  for (const [product, operation, units] of [
    ["foursquare-premium", "detail", 1],
    ["foursquare-pro", "photos", 1],
    ["google-details", "detail", 0],
    ["google-tiles", "tile", NaN]
  ] as const) {
    assert.throws(() => budgetPolicy(product, operation, units), ProviderBudgetError);
  }
});

test("explicit provider-managed integrations do not wait for local allocation or a database", async () => {
  const db = (() => {
    throw new Error("Database must not be contacted");
  }) as unknown as postgres.Sql;
  const repository = createProviderBudgetRepository(
    db,
    () => false,
    () => true
  );
  for (const request of [
    { product: "mapy-credits" as const, account: "", operation: "route", units: 4 },
    { product: "foursquare-pro" as const, account: "", operation: "detail" }
  ]) {
    assert.equal(await repository.available(request), true);
    assert.match(await repository.reserve(request), /^provider-managed:/);
    await assert.rejects(repository.reserve(request, AbortSignal.abort()));
  }
  // Google must fail closed even when other providers enforce their own limits.
  const google = { product: "google-tiles" as const, account: "mapos", operation: "tile" };
  assert.equal(await repository.available(google), false);
  await assert.rejects(repository.reserve(google), ProviderBudgetError);
  await assert.rejects(
    repository.reserve({ product: "google-photos", account: "", operation: "photo" }),
    ProviderBudgetError
  );
});

test(
  "PostgreSQL serializes budgets across connections, persists usage, and fails closed",
  { skip: !process.env.MAPOS_BUDGET_TEST_DATABASE_URL },
  async (t) => {
    const url = process.env.MAPOS_BUDGET_TEST_DATABASE_URL!;
    const a = postgres(url, { max: 6 }),
      b = postgres(url, { max: 6 });
    for (const step of providerBudgetsMigration.steps) await a.unsafe(step.sql);
    const account = `test-${randomUUID()}`;
    const id = randomUUID();
    t.after(async () => {
      await a`DELETE FROM provider_budget_reservations WHERE allocation_id = ${id}`;
      await a`DELETE FROM provider_budget_days WHERE allocation_id = ${id}`;
      await a`DELETE FROM provider_budget_allocations WHERE id = ${id}`;
      await a.end();
      await b.end();
    });
    const one = createProviderBudgetRepository(a),
      two = createProviderBudgetRepository(b);
    const input = { product: "foursquare-pro" as const, account, operation: "detail" };
    await assert.rejects(
      one.reserve(input),
      (e) => e instanceof ProviderBudgetError && e.code === "budget-disabled"
    );
    await a`INSERT INTO provider_budget_allocations (id,provider,account,sku,period_start,period_end,verified_at,verification_reference,unit_limit,enabled)
    VALUES (${id},'foursquare',${account},'places-pro',NOW()-INTERVAL '1 day',NOW()+INTERVAL '20 days',NOW(),'synthetic-test-only',1,true)`;
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, (_, i) => (i % 2 ? one : two).reserve(input))
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      results.filter((r) => r.status === "rejected" && r.reason.code === "budget-exhausted").length,
      23
    );
    await b.end();
    const reopened = postgres(url);
    try {
      await assert.rejects(
        createProviderBudgetRepository(reopened).reserve(input),
        (e) => e instanceof ProviderBudgetError && e.code === "budget-exhausted"
      );
    } finally {
      await reopened.end();
    }
    // Increasing the allocation never resets consumed units; daily cap is independent of monthly cap.
    await a`UPDATE provider_budget_allocations SET unit_limit = 450 WHERE id = ${id}`;
    await Promise.all(Array.from({ length: 14 }, () => one.reserve(input)));
    await assert.rejects(
      one.reserve(input),
      (e) => e instanceof ProviderBudgetError && e.code === "budget-exhausted"
    );
    const used = await a`SELECT used FROM provider_budget_allocations WHERE id = ${id}`;
    assert.equal(Number(used[0]!.used), 15);
    assert.equal(
      Number(
        (await a`SELECT count(*) FROM provider_budget_reservations WHERE allocation_id = ${id}`)[0]!
          .count
      ),
      15
    );
  }
);

test("operator-managed Ollama bypasses only monthly admission, preserving validation and cancellation", async () => {
  const db = (() => {
    throw new Error("no database");
  }) as unknown as postgres.Sql;
  const repository = createProviderBudgetRepository(db, () => true);
  const request = {
    product: "ai-overview-tokens" as const,
    account: "mapos-owner",
    operation: "synthesis",
    units: 18400
  };
  assert.equal(await repository.available(request), true);
  assert.match(await repository.reserve(request), /^provider-managed:/);
  assert.equal(await repository.available({ ...request, account: "" }), false);
  await assert.rejects(
    repository.reserve({ ...request, operation: "arbitrary" }),
    ProviderBudgetError
  );
  await assert.rejects(repository.reserve(request, AbortSignal.abort()));
  assert.equal(
    await repository.available({
      product: "google-tiles",
      account: "mapos-owner",
      operation: "tile"
    }),
    false
  );
  await assert.rejects(
    repository.reserve({ product: "foursquare-pro", account: "mapos-owner", operation: "detail" }),
    ProviderBudgetError
  );
  assert.equal(await createProviderBudgetRepository(db, () => false).available(request), false);
});
