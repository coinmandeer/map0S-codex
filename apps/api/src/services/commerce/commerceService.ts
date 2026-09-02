import { createHash } from "node:crypto";
import {
  MAPOS_V2_SCHEMA_VERSION,
  assertEntitlementV2,
  isEntitlementEffective,
  type CommerceProductTypeV2,
  type EntitlementGrantV2,
  type EntitlementStatusV2,
  type EntitlementV2
} from "@mapos/layer-sdk";
import type { PaymentProviderAdapter, ProviderCheckoutSession } from "./paymentProvider.js";
import type {
  CommerceCatalogRecord,
  CommerceEventEffect,
  CommerceOrderRecord,
  CommerceReferralRecord,
  CommerceRepository,
  CommerceSubscriptionRecord,
  CommerceTipRecord,
  PaymentEventType,
  StoredEntitlement,
  SubscriptionStatus,
  VerifiedPaymentEvent
} from "./commerceRepository.js";

export class CommerceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

function digest(value: string, length = 32): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

function boundedText(value: string, field: string, max: number): void {
  if (!value.trim() || value.length > max) {
    throw new CommerceError(`${field} is invalid`, 422, "invalid-commerce-input");
  }
}

function assertApprovedContract(bundle: CommerceCatalogRecord): void {
  const contract = bundle.contract;
  const requiredText = [
    contract.authenticationMethod,
    contract.referralTerms,
    contract.revenueShareTerms,
    contract.supportOwner,
    contract.refundOwner,
    contract.attribution,
    contract.branding,
    contract.terminationPolicy,
    contract.rateLimit,
    contract.geographicLimit,
    contract.privacyBasis,
    contract.legalOwner
  ];
  if (
    contract.status !== "approved" ||
    requiredText.some((value) => !value.trim()) ||
    contract.product.type !== bundle.product.type ||
    contract.product.id !== bundle.product.id ||
    bundle.product.useCaseId !== contract.id ||
    contract.billingUnit !== bundle.offer.billingUnit
  ) {
    throw new CommerceError(
      "Commerce use case has not passed the contract gate",
      409,
      "commerce-contract-gated"
    );
  }
}

function entitlementId(bundle: CommerceCatalogRecord, userId: string): string {
  return `ent:${digest(`${bundle.product.type}\u0000${bundle.product.id}\u0000user\u0000${userId}`, 48)}`;
}

function orderStatus(type: PaymentEventType): CommerceOrderRecord["status"] | null {
  if (type === "order.paid" || type === "subscription.active") return "paid";
  if (type === "order.cancelled") return "cancelled";
  if (type === "order.refunded" || type === "subscription.refunded") return "refunded";
  return null;
}

function subscriptionStatus(type: PaymentEventType): SubscriptionStatus | null {
  const status: Partial<Record<PaymentEventType, SubscriptionStatus>> = {
    "subscription.active": "active",
    "subscription.past_due": "past_due",
    "subscription.cancel_at_period_end": "cancel_at_period_end",
    "subscription.cancelled": "cancelled",
    "subscription.expired": "expired",
    "subscription.refunded": "refunded"
  };
  return status[type] ?? null;
}

function entitlementStatus(
  type: PaymentEventType,
  billingUnit: CommerceCatalogRecord["offer"]["billingUnit"]
): EntitlementStatusV2 | null {
  const status: Partial<Record<PaymentEventType, EntitlementStatusV2>> = {
    "order.paid": "active",
    "order.refunded": "refunded",
    "subscription.active": "active",
    "subscription.past_due": "grace",
    "subscription.cancel_at_period_end": "active",
    "subscription.cancelled": "revoked",
    "subscription.expired": "expired",
    "subscription.refunded": "refunded"
  };
  if (type === "order.paid" && billingUnit !== "one-time" && billingUnit !== "usage") return null;
  return status[type] ?? null;
}

function ledgerType(type: PaymentEventType): CommerceEventEffect["ledger"]["entryType"] {
  if (type === "tip.paid") return "tip";
  if (type === "order.paid" || type === "subscription.active") return "grant";
  if (type.endsWith("refunded")) return "refund";
  if (type.endsWith("cancelled") || type === "subscription.cancel_at_period_end") return "cancel";
  if (type.endsWith("expired")) return "expire";
  return "revoke";
}

export interface SafeCatalogEntry {
  product: {
    id: string;
    type: CommerceProductTypeV2;
    name: string;
    description: string | null;
    publicMetadata: Record<string, unknown>;
  };
  offer: {
    id: string;
    billingUnit: CommerceCatalogRecord["offer"]["billingUnit"];
    amountMinor: number;
    currency: string;
    periodCount: number;
  };
  access: {
    locked: boolean;
    action: "login" | "purchase" | "open" | "unavailable";
  };
}

export type CommerceAccessSurface =
  "feature-query" | "detail" | "export" | "ai-tool" | "background-sync" | "offline-package";

/** Provider-neutral domain service. The browser cannot pass or manufacture an entitlement. */
export class CommerceService {
  constructor(
    private readonly repository: CommerceRepository,
    private readonly provider: PaymentProviderAdapter | null = null,
    private readonly now: () => Date = () => new Date()
  ) {}

  providerCapability() {
    return {
      core: true,
      checkout: Boolean(this.provider),
      provider: this.provider?.id ?? "none",
      synthetic: this.provider?.synthetic ?? false
    } as const;
  }

  async catalog(userId: string | null): Promise<SafeCatalogEntry[]> {
    const rows = (await this.repository.listCatalog()).filter(
      (row) =>
        row.contract.status === "approved" &&
        row.product.status === "active" &&
        row.offer.status === "active"
    );
    return Promise.all(
      rows.map(async (row) => {
        const allowed = userId
          ? await this.hasEntitlement(userId, row.product.type, row.product.id, "view")
          : false;
        return {
          product: {
            id: row.product.id,
            type: row.product.type,
            name: row.product.name,
            description: row.product.description,
            publicMetadata: structuredClone(row.product.publicMetadata)
          },
          offer: {
            id: row.offer.id,
            billingUnit: row.offer.billingUnit,
            amountMinor: row.offer.amountMinor,
            currency: row.offer.currency,
            periodCount: row.offer.periodCount
          },
          access: {
            locked: !allowed,
            action: allowed
              ? "open"
              : userId
                ? this.provider
                  ? "purchase"
                  : "unavailable"
                : "login"
          }
        };
      })
    );
  }

  async listEntitlements(
    userId: string
  ): Promise<Array<{ entitlement: EntitlementV2; effective: boolean }>> {
    const rows = await this.repository.listEntitlements("user", userId);
    return rows.map(({ document }) => ({
      entitlement: structuredClone(document),
      effective: document.grants.some((grant) =>
        isEntitlementEffective(document, grant, this.now())
      )
    }));
  }

  async hasEntitlement(
    userId: string,
    productType: CommerceProductTypeV2,
    productId: string,
    grant: EntitlementGrantV2
  ): Promise<boolean> {
    const stored = await this.repository.findEntitlement("user", userId, productType, productId);
    return stored ? isEntitlementEffective(stored.document, grant, this.now()) : false;
  }

  async assertEntitled(
    userId: string,
    productType: CommerceProductTypeV2,
    productId: string,
    grant: EntitlementGrantV2
  ): Promise<void> {
    if (!(await this.hasEntitlement(userId, productType, productId, grant))) {
      throw new CommerceError("Entitlement required", 403, "entitlement-required");
    }
  }

  async hasSurfaceAccess(
    userId: string,
    productType: CommerceProductTypeV2,
    productId: string,
    surface: CommerceAccessSurface
  ): Promise<boolean> {
    const bundle = (await this.repository.listCatalog()).find(
      (row) => row.product.type === productType && row.product.id === productId
    );
    if (!bundle || bundle.contract.status !== "approved") return false;
    const policy: Record<
      CommerceAccessSurface,
      { grant: EntitlementGrantV2; contractAllows: boolean }
    > = {
      "feature-query": { grant: "query", contractAllows: bundle.contract.rights.display },
      detail: { grant: "detail", contractAllows: bundle.contract.rights.display },
      export: { grant: "export", contractAllows: bundle.contract.rights.export },
      "ai-tool": { grant: "query", contractAllows: bundle.contract.rights.aiTools },
      "background-sync": {
        grant: "query",
        contractAllows: bundle.contract.rights.backgroundSync
      },
      "offline-package": {
        grant: "query",
        contractAllows: bundle.contract.rights.offline && bundle.contract.rights.cache
      }
    };
    const decision = policy[surface];
    return (
      decision.contractAllows &&
      (await this.hasEntitlement(userId, productType, productId, decision.grant))
    );
  }

  async assertSurfaceAccess(
    userId: string,
    productType: CommerceProductTypeV2,
    productId: string,
    surface: CommerceAccessSurface
  ): Promise<void> {
    if (!(await this.hasSurfaceAccess(userId, productType, productId, surface))) {
      throw new CommerceError(
        "Entitlement or provider contract does not allow this operation",
        403,
        "commerce-surface-denied"
      );
    }
  }

  async createCheckout(
    userId: string,
    input: { offerId: string; idempotencyKey: string; referralId?: string | null }
  ): Promise<{ order: CommerceOrderRecord; session: ProviderCheckoutSession }> {
    boundedText(input.offerId, "offerId", 200);
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new CommerceError("idempotencyKey is invalid", 422, "invalid-commerce-input");
    }
    if (!this.provider) {
      throw new CommerceError(
        "No payment provider is enabled for this deployment",
        503,
        "commerce-provider-disabled"
      );
    }
    const bundle = await this.repository.findOffer(input.offerId);
    if (
      !bundle ||
      bundle.product.status !== "active" ||
      bundle.offer.status !== "active" ||
      bundle.offer.billingUnit === "tip"
    ) {
      throw new CommerceError("Offer not found", 404, "offer-not-found");
    }
    assertApprovedContract(bundle);
    if (!this.provider.synthetic && !bundle.contract.realProviderApproved) {
      throw new CommerceError(
        "The real payment provider gate is closed",
        503,
        "real-provider-gated"
      );
    }
    const timestamp = this.now().toISOString();
    const orderId = `order:${digest(`${userId}\u0000${input.idempotencyKey}`)}`;
    const existing = await this.repository.findOrder(orderId);
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.offerId !== bundle.offer.id ||
        existing.referralId !== (input.referralId ?? null)
      ) {
        throw new CommerceError(
          "Idempotency key was reused for a different checkout",
          409,
          "idempotency-conflict"
        );
      }
      return {
        order: existing,
        session: await this.provider.createCheckoutSession({
          order: existing,
          idempotencyKey: input.idempotencyKey
        })
      };
    }
    if (input.referralId) {
      const referral = await this.repository.findReferral(input.referralId);
      if (
        !referral ||
        Date.parse(referral.expiresAt) <= this.now().getTime() ||
        referral.convertedOrderId
      ) {
        throw new CommerceError(
          "Referral is missing, expired or already converted",
          422,
          "invalid-referral"
        );
      }
    }
    const pending: CommerceOrderRecord = {
      id: orderId,
      userId,
      offerId: bundle.offer.id,
      status: "pending",
      provider: this.provider.id,
      providerOrderId: null,
      idempotencyKey: input.idempotencyKey,
      amountMinor: bundle.offer.amountMinor,
      currency: bundle.offer.currency,
      referralId: input.referralId ?? null,
      createdAt: timestamp,
      paidAt: null,
      cancelledAt: null,
      refundedAt: null,
      updatedAt: timestamp
    };
    const session = await this.provider.createCheckoutSession({
      order: pending,
      idempotencyKey: input.idempotencyKey
    });
    const order = await this.repository.createOrder({
      ...pending,
      providerOrderId: session.providerOrderId
    });
    return { order, session };
  }

  async recordReferral(
    userId: string,
    input: { campaign: string; partnerId: string; source: string; consent: true }
  ): Promise<CommerceReferralRecord> {
    boundedText(input.campaign, "campaign", 120);
    boundedText(input.partnerId, "partnerId", 160);
    boundedText(input.source, "source", 160);
    if (input.consent !== true) {
      throw new CommerceError("Referral attribution requires consent", 422, "consent-required");
    }
    const now = this.now();
    const clickedAt = now.toISOString();
    const sessionHash = digest(`${userId}\u0000${input.campaign}\u0000${input.partnerId}`, 64);
    const dedupeKey = digest(
      `${sessionHash}\u0000${input.source}\u0000${clickedAt.slice(0, 10)}`,
      64
    );
    return this.repository.createReferral({
      id: `ref:${dedupeKey.slice(0, 32)}`,
      campaign: input.campaign,
      partnerId: input.partnerId,
      source: input.source,
      sessionHash,
      dedupeKey,
      clickedAt,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      consentedAt: clickedAt,
      privacyBasis: "user-consent",
      convertedOrderId: null,
      convertedAt: null,
      payoutStatus: "not-applicable",
      metadata: {},
      createdAt: clickedAt
    });
  }

  async createTip(
    userId: string,
    input: {
      recipientType: CommerceTipRecord["recipientType"];
      recipientId: string;
      amountMinor: number;
      currency: string;
      idempotencyKey: string;
    }
  ): Promise<{ tip: CommerceTipRecord; session: ProviderCheckoutSession }> {
    boundedText(input.recipientId, "recipientId", 200);
    if (
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor <= 0 ||
      input.amountMinor > 1_000_000_000 ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !IDEMPOTENCY_KEY.test(input.idempotencyKey)
    ) {
      throw new CommerceError(
        "Tip amount, currency or idempotency key is invalid",
        422,
        "invalid-commerce-input"
      );
    }
    if (!this.provider) {
      throw new CommerceError(
        "No payment provider is enabled for tips",
        503,
        "commerce-provider-disabled"
      );
    }
    const tipProductId = `tip-recipient:${input.recipientType}:${input.recipientId}`;
    const bundle = (await this.repository.listCatalog()).find(
      (row) => row.product.id === tipProductId && row.offer.billingUnit === "tip"
    );
    if (!bundle || bundle.product.status !== "active" || bundle.offer.status !== "active") {
      throw new CommerceError("Tip recipient is not approved", 404, "tip-recipient-gated");
    }
    assertApprovedContract(bundle);
    if (!this.provider.synthetic && !bundle.contract.realProviderApproved) {
      throw new CommerceError("The real tip provider gate is closed", 503, "real-provider-gated");
    }
    const timestamp = this.now().toISOString();
    const tip: CommerceTipRecord = {
      id: `tip:${digest(`${userId}\u0000${input.idempotencyKey}`)}`,
      userId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      provider: this.provider.id,
      network: null,
      amountMinor: input.amountMinor,
      feeMinor: 0,
      currency: input.currency,
      status: "pending",
      providerTransactionId: null,
      idempotencyKey: input.idempotencyKey,
      errorCode: null,
      createdAt: timestamp,
      paidAt: null,
      refundedAt: null,
      updatedAt: timestamp
    };
    const session = await this.provider.createTipSession({
      tip,
      idempotencyKey: input.idempotencyKey
    });
    tip.providerTransactionId = session.providerOrderId;
    return { tip: await this.repository.createTip(tip), session };
  }

  async processWebhook(
    providerId: string,
    payload: unknown,
    signature: string | undefined
  ): Promise<{ duplicate: boolean; ledgerOperation: string | null }> {
    if (!this.provider || providerId !== this.provider.id) {
      throw new CommerceError("Payment provider is disabled", 404, "provider-disabled");
    }
    let event: VerifiedPaymentEvent;
    try {
      event = this.provider.verifyWebhook(payload, signature);
    } catch {
      throw new CommerceError("Invalid webhook signature or payload", 401, "invalid-webhook");
    }
    if (event.provider !== this.provider.id) {
      throw new CommerceError("Webhook provider identity mismatch", 401, "invalid-webhook");
    }
    const effect = await this.effectFor(event);
    let result: Awaited<ReturnType<CommerceRepository["applyPaymentEvent"]>>;
    try {
      result = await this.repository.applyPaymentEvent(event, effect);
    } catch (error) {
      if (error instanceof Error && error.message.includes("event ID was reused")) {
        throw new CommerceError(
          "Provider event ID conflicts with an already stored payload",
          409,
          "provider-event-conflict"
        );
      }
      throw error;
    }
    return { duplicate: result.duplicate, ledgerOperation: result.ledger?.operationKey ?? null };
  }

  reconcile(at: Date = this.now()) {
    return this.repository.reconcile(at);
  }

  private async effectFor(event: VerifiedPaymentEvent): Promise<CommerceEventEffect> {
    const operationKey = `payment:${event.provider}:${event.providerEventId}`;
    if (event.type.startsWith("tip.")) {
      const tip = event.tipId ? await this.repository.findTip(event.tipId) : null;
      if (!tip) throw new CommerceError("Webhook references an unknown tip", 422, "unknown-tip");
      const status = event.type === "tip.paid" ? "paid" : "refunded";
      return {
        tip: {
          id: tip.id,
          status,
          paidAt: status === "paid" ? event.occurredAt : tip.paidAt,
          refundedAt: status === "refunded" ? event.occurredAt : tip.refundedAt
        },
        ledger: {
          id: `ledger:${digest(operationKey)}`,
          operationKey,
          orderId: null,
          subscriptionId: null,
          entitlementId: null,
          entryType: status === "paid" ? "tip" : "refund",
          effectiveAt: event.occurredAt,
          reason: event.type,
          metadata: { tipId: tip.id },
          createdAt: event.occurredAt
        }
      };
    }

    const order = event.orderId ? await this.repository.findOrder(event.orderId) : null;
    if (!order)
      throw new CommerceError("Webhook references an unknown order", 422, "unknown-order");
    if (order.provider !== event.provider) {
      throw new CommerceError("Webhook provider does not own this order", 422, "provider-mismatch");
    }
    const bundle = await this.repository.findOffer(order.offerId);
    if (!bundle) throw new CommerceError("Order offer no longer exists", 422, "unknown-offer");
    assertApprovedContract(bundle);

    if (
      event.type.startsWith("subscription.") &&
      bundle.offer.billingUnit !== "month" &&
      bundle.offer.billingUnit !== "year"
    ) {
      throw new CommerceError(
        "Subscription event references a non-recurring offer",
        422,
        "subscription-offer-mismatch"
      );
    }

    const requestedOrderStatus = orderStatus(event.type);
    let requestedSubscriptionStatus = subscriptionStatus(event.type);
    let requestedEntitlementStatus = entitlementStatus(event.type, bundle.offer.billingUnit);
    if (
      (event.type === "order.paid" || event.type === "subscription.active") &&
      order.status === "cancelled"
    ) {
      requestedEntitlementStatus = null;
      if (event.type === "subscription.active") requestedSubscriptionStatus = "cancelled";
    }
    if (
      (event.type === "order.paid" || event.type === "subscription.active") &&
      order.status === "refunded"
    ) {
      requestedEntitlementStatus = "refunded";
      if (event.type === "subscription.active") requestedSubscriptionStatus = "refunded";
    }
    if (event.type === "subscription.active" && (!event.periodStart || !event.periodEnd)) {
      throw new CommerceError(
        "Active subscription event requires an explicit period",
        422,
        "invalid-subscription-period"
      );
    }
    if (event.type === "subscription.cancel_at_period_end" && !event.periodEnd) {
      throw new CommerceError(
        "Cancellation-at-period-end requires periodEnd",
        422,
        "invalid-subscription-period"
      );
    }
    if (
      event.type === "subscription.past_due" &&
      (!event.graceEndsAt || Date.parse(event.graceEndsAt) <= Date.parse(event.occurredAt))
    ) {
      requestedEntitlementStatus = "expired";
    }
    const existing = await this.repository.findEntitlement(
      "user",
      order.userId,
      bundle.product.type,
      bundle.product.id
    );
    const entId = entitlementId(bundle, order.userId);
    const end =
      event.type === "subscription.past_due"
        ? (event.graceEndsAt ?? event.periodEnd ?? existing?.document.endsAt ?? null)
        : (event.periodEnd ?? existing?.document.endsAt ?? null);
    const entitlement: StoredEntitlement | undefined = requestedEntitlementStatus
      ? {
          userId: order.userId,
          orderId: order.id,
          subscriptionId: event.subscriptionId ?? existing?.subscriptionId ?? null,
          document: {
            schema: "mapos.entitlement",
            schemaVersion: MAPOS_V2_SCHEMA_VERSION,
            id: entId,
            subject: { type: "user", id: order.userId },
            product: {
              type: bundle.product.type,
              id: bundle.product.id,
              providerId: bundle.product.providerId
            },
            status: requestedEntitlementStatus,
            grants: structuredClone(bundle.offer.grants),
            source: {
              provider: event.provider === "synthetic" ? "mapos" : event.provider,
              externalCustomerId: null,
              externalTransactionId: order.providerOrderId,
              referralId: order.referralId
            },
            startsAt: event.periodStart ?? existing?.document.startsAt ?? event.occurredAt,
            endsAt: end,
            metadata: {
              paymentAdapter: event.provider,
              synthetic: this.provider?.synthetic ?? false
            },
            createdAt: existing?.document.createdAt ?? event.occurredAt,
            updatedAt: event.occurredAt
          }
        }
      : undefined;
    if (entitlement) assertEntitlementV2(entitlement.document);

    let subscription: CommerceSubscriptionRecord | undefined;
    if (requestedSubscriptionStatus) {
      if (!event.subscriptionId) {
        throw new CommerceError(
          "Subscription event has no subscriptionId",
          422,
          "invalid-subscription-event"
        );
      }
      subscription = {
        id: event.subscriptionId,
        userId: order.userId,
        offerId: order.offerId,
        status: requestedSubscriptionStatus,
        provider: event.provider,
        providerSubscriptionId: event.subscriptionId,
        currentPeriodStart: event.periodStart ?? null,
        currentPeriodEnd: event.periodEnd ?? null,
        graceEndsAt: event.graceEndsAt ?? null,
        cancelAt:
          requestedSubscriptionStatus === "cancel_at_period_end" ? (event.periodEnd ?? null) : null,
        endedAt: ["cancelled", "expired", "refunded"].includes(requestedSubscriptionStatus)
          ? event.occurredAt
          : null,
        createdAt: event.periodStart ?? event.occurredAt,
        updatedAt: event.occurredAt
      };
    }
    const referral = order.referralId ? await this.repository.findReferral(order.referralId) : null;
    if (order.referralId && !referral) {
      throw new CommerceError("Order referral no longer exists", 422, "unknown-referral");
    }
    const referralEffect =
      referral &&
      ((requestedOrderStatus === "paid" &&
        order.status !== "refunded" &&
        Date.parse(event.occurredAt) < Date.parse(referral.expiresAt)) ||
        (requestedOrderStatus === "refunded" && referral.convertedOrderId === order.id))
        ? {
            id: referral.id,
            orderId: order.id,
            convertedAt:
              requestedOrderStatus === "paid" ? event.occurredAt : (referral.convertedAt ?? null),
            payoutStatus: (requestedOrderStatus === "refunded"
              ? "void"
              : this.provider?.synthetic
                ? "not-applicable"
                : "pending") as CommerceReferralRecord["payoutStatus"]
          }
        : undefined;
    return {
      ...(requestedOrderStatus
        ? {
            order: {
              id: order.id,
              status: requestedOrderStatus,
              paidAt: requestedOrderStatus === "paid" ? event.occurredAt : order.paidAt,
              cancelledAt:
                requestedOrderStatus === "cancelled" ? event.occurredAt : order.cancelledAt,
              refundedAt: requestedOrderStatus === "refunded" ? event.occurredAt : order.refundedAt
            }
          }
        : {}),
      ...(subscription ? { subscription } : {}),
      ...(entitlement ? { entitlement } : {}),
      ...(referralEffect ? { referral: referralEffect } : {}),
      ledger: {
        id: `ledger:${digest(operationKey)}`,
        operationKey,
        orderId: order.id,
        subscriptionId: event.subscriptionId ?? null,
        entitlementId: entitlement?.document.id ?? existing?.document.id ?? null,
        entryType:
          (event.type === "order.paid" || event.type === "subscription.active") &&
          entitlement?.document.status !== "active"
            ? "payment"
            : ledgerType(event.type),
        effectiveAt: event.occurredAt,
        reason: event.type,
        metadata: { payloadHash: event.payloadHash },
        createdAt: event.occurredAt
      }
    };
  }
}

/** Resolves server-verified product IDs for AI/tool context; no client-provided set is accepted. */
export async function verifiedEntitlementProductIds(
  service: CommerceService,
  userId: string
): Promise<ReadonlySet<string>> {
  const rows = await service.listEntitlements(userId);
  const allowed = await Promise.all(
    rows.map(async (row) => ({
      row,
      allowed:
        row.effective &&
        (await service.hasSurfaceAccess(
          userId,
          row.entitlement.product.type,
          row.entitlement.product.id,
          "ai-tool"
        ))
    }))
  );
  return new Set(
    allowed.filter((candidate) => candidate.allowed).map(({ row }) => row.entitlement.product.id)
  );
}

/** Feature/detail/export/offline callers wrap their resolver so denied data is never fetched. */
export async function loadEntitledResource<T>(
  service: CommerceService,
  input: {
    userId: string;
    productType: CommerceProductTypeV2;
    productId: string;
    grant: EntitlementGrantV2;
  },
  load: () => Promise<T>
): Promise<T> {
  await service.assertEntitled(input.userId, input.productType, input.productId, input.grant);
  return load();
}

export async function loadEntitledSurface<T>(
  service: CommerceService,
  input: {
    userId: string;
    productType: CommerceProductTypeV2;
    productId: string;
    surface: CommerceAccessSurface;
  },
  load: () => Promise<T>
): Promise<T> {
  await service.assertSurfaceAccess(
    input.userId,
    input.productType,
    input.productId,
    input.surface
  );
  return load();
}
