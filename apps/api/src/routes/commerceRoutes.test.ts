import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { syntheticCommerceCatalog } from "../services/commerce/commerceFixtures.js";
import { MemoryCommerceRepository } from "../services/commerce/commerceMemoryRepository.js";
import { CommerceService } from "../services/commerce/commerceService.js";
import { SyntheticPaymentProvider } from "../services/commerce/paymentProvider.js";
import { registerCommerceRoutes } from "./commerceRoutes.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "synthetic-commerce-route-secret-32-bytes-minimum";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(providerEnabled: boolean) {
  const now = new Date("2026-09-01T10:00:00.000Z");
  const repository = new MemoryCommerceRepository({ catalog: syntheticCommerceCatalog(now) });
  const provider = new SyntheticPaymentProvider(SECRET);
  const service = new CommerceService(repository, providerEnabled ? provider : null, () => now);
  const app = Fastify({ logger: false });
  apps.push(app);
  registerCommerceRoutes(app, {
    service,
    resolveUserId: (request) => (request.headers.authorization === "Bearer valid" ? USER : null)
  });
  return { app, provider };
}

test("shared commerce routes expose only locked metadata and fail closed without a provider", async () => {
  const { app } = setup(false);
  const catalog = await app.inject({ method: "GET", url: "/v2/commerce/catalog" });
  assert.equal(catalog.statusCode, 200);
  assert.deepEqual(catalog.json().capability, {
    core: true,
    checkout: false,
    provider: "none",
    synthetic: false
  });
  assert.equal(catalog.json().products[0].access.locked, true);
  assert.equal("grants" in catalog.json().products[0].offer, false);
  assert.equal("contract" in catalog.json().products[0], false);

  const unauthorized = await app.inject({ method: "GET", url: "/v2/me/entitlements" });
  assert.equal(unauthorized.statusCode, 401);
  const disabled = await app.inject({
    method: "POST",
    url: "/v2/commerce/checkout",
    headers: { authorization: "Bearer valid" },
    payload: {
      offerId: "offer:synthetic-camper-once",
      idempotencyKey: "route-checkout-disabled"
    }
  });
  assert.equal(disabled.statusCode, 503);
  assert.equal(disabled.json().code, "commerce-provider-disabled");

  const hostile = await app.inject({
    method: "POST",
    url: "/v2/commerce/checkout",
    headers: { authorization: "Bearer valid" },
    payload: {
      offerId: "offer:synthetic-camper-once",
      idempotencyKey: "route-hostile-0001",
      entitlement: { status: "active" }
    }
  });
  assert.equal(hostile.statusCode, 503);
  assert.equal(hostile.json().code, "commerce-provider-disabled");
});

test("signed synthetic webhook is idempotent and only server ledger unlocks access", async () => {
  const { app, provider } = setup(true);
  const headers = { authorization: "Bearer valid" };
  const checkout = await app.inject({
    method: "POST",
    url: "/v2/commerce/checkout",
    headers,
    payload: {
      offerId: "offer:synthetic-camper-once",
      idempotencyKey: "route-checkout-paid-1"
    }
  });
  assert.equal(checkout.statusCode, 202);
  assert.equal(checkout.json().session.synthetic, true);
  assert.equal(checkout.json().session.checkoutUrl, null);
  const orderId = checkout.json().order.id as string;

  const before = await app.inject({
    method: "GET",
    url: "/v2/commerce/access/layer/synthetic-premium-camper-pass?grant=query",
    headers
  });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().allowed, false);

  const event = {
    id: "route-event-paid-1",
    type: "order.paid",
    occurredAt: "2026-09-01T10:00:00.000Z",
    data: { orderId }
  };
  const invalid = await app.inject({
    method: "POST",
    url: "/v2/commerce/webhooks/synthetic",
    headers: { "x-mapos-signature": "sha256=00" },
    payload: event
  });
  assert.equal(invalid.statusCode, 401);

  const webhookHeaders = { "x-mapos-signature": `sha256=${provider.signature(event)}` };
  const applied = await app.inject({
    method: "POST",
    url: "/v2/commerce/webhooks/synthetic",
    headers: webhookHeaders,
    payload: event
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().duplicate, false);
  const replay = await app.inject({
    method: "POST",
    url: "/v2/commerce/webhooks/synthetic",
    headers: webhookHeaders,
    payload: event
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().duplicate, true);

  const after = await app.inject({
    method: "GET",
    url: "/v2/commerce/access/layer/synthetic-premium-camper-pass?grant=query",
    headers
  });
  assert.equal(after.json().allowed, true);
  const entitlements = await app.inject({
    method: "GET",
    url: "/v2/me/entitlements",
    headers
  });
  assert.equal(entitlements.json().entitlements.length, 1);
});

test("referral and tip inputs are bounded, consented and provider-gated", async () => {
  const { app } = setup(false);
  const headers = { authorization: "Bearer valid" };
  const withoutConsent = await app.inject({
    method: "POST",
    url: "/v2/commerce/referrals",
    headers,
    payload: { campaign: "launch", partnerId: "fixture", source: "catalog", consent: false }
  });
  assert.equal(withoutConsent.statusCode, 400);
  const referral = await app.inject({
    method: "POST",
    url: "/v2/commerce/referrals",
    headers,
    payload: { campaign: "launch", partnerId: "fixture", source: "catalog", consent: true }
  });
  assert.equal(referral.statusCode, 201);
  assert.match(referral.json().referral.sessionHash, /^[a-f0-9]{64}$/);

  const tip = await app.inject({
    method: "POST",
    url: "/v2/commerce/tips",
    headers,
    payload: {
      recipientType: "project",
      recipientId: "mapos",
      amountMinor: 500,
      currency: "EUR",
      idempotencyKey: "tip-provider-gated"
    }
  });
  assert.equal(tip.statusCode, 503);
  assert.equal(tip.json().code, "commerce-provider-disabled");
});
