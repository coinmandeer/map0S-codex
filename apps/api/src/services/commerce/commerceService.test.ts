import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { syntheticCommerceCatalog } from "./commerceFixtures.js";
import { MemoryCommerceRepository } from "./commerceMemoryRepository.js";
import {
  CommerceError,
  CommerceService,
  loadEntitledResource,
  loadEntitledSurface,
  verifiedEntitlementProductIds
} from "./commerceService.js";
import { SyntheticPaymentProvider } from "./paymentProvider.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "synthetic-commerce-test-secret-32-bytes-minimum";

function setup(providerEnabled = true) {
  let now = new Date("2026-09-01T10:00:00.000Z");
  const repository = new MemoryCommerceRepository({ catalog: syntheticCommerceCatalog(now) });
  const provider = new SyntheticPaymentProvider(SECRET);
  const service = new CommerceService(repository, providerEnabled ? provider : null, () => now);
  return {
    repository,
    provider,
    service,
    setNow(value: string) {
      now = new Date(value);
    }
  };
}

function signed(
  provider: SyntheticPaymentProvider,
  payload: Record<string, unknown>
): [Record<string, unknown>, string] {
  return [payload, `sha256=${provider.signature(payload)}`];
}

describe("provider-neutral commerce core", () => {
  it("remains useful without a provider while checkout and hidden payloads fail closed", async () => {
    const { service } = setup(false);
    const catalog = await service.catalog(null);
    assert.equal(catalog.length, 3);
    assert.equal(catalog[0]!.access.action, "login");
    assert.equal(catalog[0]!.access.locked, true);
    assert.equal("grants" in catalog[0]!.offer, false);
    assert.equal("contract" in catalog[0]!, false);
    await assert.rejects(
      () =>
        service.createCheckout(USER, {
          offerId: "offer:synthetic-camper-month",
          idempotencyKey: "checkout-disabled-1"
        }),
      (error: unknown) =>
        error instanceof CommerceError && error.code === "commerce-provider-disabled"
    );

    let loaderCalls = 0;
    await assert.rejects(
      () =>
        loadEntitledResource(
          service,
          {
            userId: USER,
            productType: "layer",
            productId: "synthetic-premium-camper",
            grant: "query"
          },
          async () => {
            loaderCalls += 1;
            return [{ secret: "premium" }];
          }
        ),
      (error: unknown) => error instanceof CommerceError && error.statusCode === 403
    );
    assert.equal(loaderCalls, 0, "denied feature resolver must never be invoked");
  });

  it("grants once for a signed paid event, deduplicates replay and never reopens a refund", async () => {
    const { repository, provider, service, setNow } = setup();
    const { order } = await service.createCheckout(USER, {
      offerId: "offer:synthetic-camper-once",
      idempotencyKey: "checkout-paid-0001"
    });
    const paid = {
      id: "evt-paid-1",
      type: "order.paid",
      occurredAt: "2026-09-01T10:01:00.000Z",
      data: { orderId: order.id }
    };
    const [paidBody, paidSignature] = signed(provider, paid);
    assert.deepEqual(await service.processWebhook("synthetic", paidBody, paidSignature), {
      duplicate: false,
      ledgerOperation: "payment:synthetic:evt-paid-1"
    });
    assert.deepEqual(await service.processWebhook("synthetic", paidBody, paidSignature), {
      duplicate: true,
      ledgerOperation: null
    });
    const conflictingPaid = { ...paid, occurredAt: "2026-09-01T10:01:01.000Z" };
    await assert.rejects(
      () => service.processWebhook("synthetic", ...signed(provider, conflictingPaid)),
      (error: unknown) => error instanceof CommerceError && error.code === "provider-event-conflict"
    );
    setNow("2026-09-01T10:02:00.000Z");
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper-pass", "query"),
      true
    );
    assert.equal(repository.ledgerEntries().length, 1);

    let aiLoaderCalls = 0;
    await assert.rejects(
      () =>
        loadEntitledSurface(
          service,
          {
            userId: USER,
            productType: "layer",
            productId: "synthetic-premium-camper-pass",
            surface: "ai-tool"
          },
          async () => {
            aiLoaderCalls += 1;
            return "hidden";
          }
        ),
      (error: unknown) => error instanceof CommerceError && error.code === "commerce-surface-denied"
    );
    assert.equal(aiLoaderCalls, 0);
    assert.deepEqual([...(await verifiedEntitlementProductIds(service, USER))], []);

    const refund = {
      id: "evt-refund-1",
      type: "order.refunded",
      occurredAt: "2026-09-01T11:00:00.000Z",
      data: { orderId: order.id }
    };
    const [refundBody, refundSignature] = signed(provider, refund);
    await service.processWebhook("synthetic", refundBody, refundSignature);
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper-pass", "query"),
      false
    );

    const latePaid = {
      id: "evt-paid-late",
      type: "order.paid",
      occurredAt: "2026-09-01T12:00:00.000Z",
      data: { orderId: order.id }
    };
    const [lateBody, lateSignature] = signed(provider, latePaid);
    await service.processWebhook("synthetic", lateBody, lateSignature);
    const rows = await service.listEntitlements(USER);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entitlement.status, "refunded");
    assert.equal(repository.ledgerEntries().length, 3);
  });

  it("keeps cancel-at-period-end access until the half-open expiry then reconciles exactly once", async () => {
    const { repository, provider, service, setNow } = setup();
    const { order } = await service.createCheckout(USER, {
      offerId: "offer:synthetic-camper-month",
      idempotencyKey: "checkout-subscription-1"
    });
    const paymentOnly = {
      id: "evt-sub-payment",
      type: "order.paid",
      occurredAt: "2026-09-01T10:01:00.000Z",
      data: { orderId: order.id }
    };
    await service.processWebhook("synthetic", ...signed(provider, paymentOnly));
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper", "view"),
      false,
      "a recurring payment without an active subscription period must not grant access"
    );
    const active = {
      id: "evt-sub-active",
      type: "subscription.active",
      occurredAt: "2026-09-01T10:02:00.000Z",
      data: {
        orderId: order.id,
        subscriptionId: "sub:fixture-1",
        periodStart: "2026-09-01T10:02:00.000Z",
        periodEnd: "2026-10-01T10:02:00.000Z"
      }
    };
    await service.processWebhook("synthetic", ...signed(provider, active));
    const cancelling = {
      id: "evt-sub-cancel-at-end",
      type: "subscription.cancel_at_period_end",
      occurredAt: "2026-09-10T10:00:00.000Z",
      data: {
        orderId: order.id,
        subscriptionId: "sub:fixture-1",
        periodEnd: "2026-10-01T10:02:00.000Z"
      }
    };
    await service.processWebhook("synthetic", ...signed(provider, cancelling));
    setNow("2026-10-01T10:01:59.999Z");
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper", "view"),
      true
    );
    setNow("2026-10-01T10:02:00.000Z");
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper", "view"),
      false
    );
    const first = await service.reconcile();
    const second = await service.reconcile();
    assert.equal(first.repairedCount, 1);
    assert.equal(second.repairedCount, 0);
    assert.equal(repository.ledgerEntries().filter((row) => row.entryType === "expire").length, 1);
  });

  it("rejects unsigned webhook state and deduplicates consented referral attribution", async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.processWebhook(
          "synthetic",
          {
            id: "evt-forged",
            type: "order.paid",
            occurredAt: "2026-09-01T10:00:00Z",
            data: { orderId: "unknown" }
          },
          "sha256=00"
        ),
      (error: unknown) => error instanceof CommerceError && error.code === "invalid-webhook"
    );
    const input = {
      campaign: "launch",
      partnerId: "partner-fixture",
      source: "catalog",
      consent: true as const
    };
    const first = await service.recordReferral(USER, input);
    const second = await service.recordReferral(USER, input);
    assert.equal(first.id, second.id);
    assert.match(first.sessionHash, /^[a-f0-9]{64}$/);
    assert.equal("userId" in first, false);
  });

  it("links a consented referral on conversion and records tip payment/refund without wallet coupling", async () => {
    const { repository, provider, service } = setup();
    const referral = await service.recordReferral(USER, {
      campaign: "launch",
      partnerId: "partner-fixture",
      source: "catalog",
      consent: true
    });
    const { order } = await service.createCheckout(USER, {
      offerId: "offer:synthetic-camper-once",
      idempotencyKey: "checkout-referred-1",
      referralId: referral.id
    });
    const paid = {
      id: "evt-referred-paid",
      type: "order.paid",
      occurredAt: "2026-09-01T10:01:00.000Z",
      data: { orderId: order.id }
    };
    await service.processWebhook("synthetic", ...signed(provider, paid));
    assert.equal((await repository.findReferral(referral.id))!.convertedOrderId, order.id);

    const { tip } = await service.createTip(USER, {
      recipientType: "project",
      recipientId: "mapos",
      amountMinor: 500,
      currency: "EUR",
      idempotencyKey: "tip-fixture-paid-1"
    });
    const tipPaid = {
      id: "evt-tip-paid",
      type: "tip.paid",
      occurredAt: "2026-09-01T10:02:00.000Z",
      data: { tipId: tip.id }
    };
    await service.processWebhook("synthetic", ...signed(provider, tipPaid));
    assert.equal((await repository.findTip(tip.id))!.status, "paid");
    assert.equal(repository.ledgerEntries().at(-1)!.entryType, "tip");
    const tipRefunded = {
      id: "evt-tip-refunded",
      type: "tip.refunded",
      occurredAt: "2026-09-01T10:03:00.000Z",
      data: { tipId: tip.id }
    };
    await service.processWebhook("synthetic", ...signed(provider, tipRefunded));
    assert.equal((await repository.findTip(tip.id))!.status, "refunded");
  });

  it("reconciliation repairs a paid one-time order with a missing entitlement", async () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    const repository = new MemoryCommerceRepository({
      catalog: syntheticCommerceCatalog(now),
      orders: [
        {
          id: "order:missing-entitlement",
          userId: USER,
          offerId: "offer:synthetic-camper-once",
          status: "paid",
          provider: "synthetic",
          providerOrderId: "synthetic-order-missing",
          idempotencyKey: "missing-entitlement-order",
          amountMinor: 1499,
          currency: "EUR",
          referralId: null,
          createdAt: "2026-09-01T10:00:00.000Z",
          paidAt: "2026-09-01T10:01:00.000Z",
          cancelledAt: null,
          refundedAt: null,
          updatedAt: "2026-09-01T10:01:00.000Z"
        }
      ]
    });
    const service = new CommerceService(repository, null, () => now);
    const result = await service.reconcile();
    assert.equal(result.repairedCount, 1);
    assert.equal(
      await service.hasEntitlement(USER, "layer", "synthetic-premium-camper-pass", "view"),
      true
    );
    assert.equal((await service.reconcile()).repairedCount, 0);
  });
});
