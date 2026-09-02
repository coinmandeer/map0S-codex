import { createHash } from "node:crypto";
import { MAPOS_V2_SCHEMA_VERSION, type EntitlementV2 } from "@mapos/layer-sdk";
import {
  mergeEntitlement,
  nextOrderStatus,
  nextSubscriptionStatus,
  nextTipStatus
} from "./commerceTransitions.js";
import type {
  CommerceCatalogRecord,
  CommerceEventEffect,
  CommerceLedgerEntry,
  CommerceOrderRecord,
  CommerceReferralRecord,
  CommerceReconciliationResult,
  CommerceRepository,
  CommerceSubscriptionRecord,
  CommerceTipRecord,
  StoredEntitlement,
  VerifiedPaymentEvent
} from "./commerceRepository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hashId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 48)}`;
}

function entitlementKey(
  subjectType: EntitlementV2["subject"]["type"],
  subjectId: string,
  productType: EntitlementV2["product"]["type"],
  productId: string
): string {
  return `${subjectType}\u0000${subjectId}\u0000${productType}\u0000${productId}`;
}

/** Deterministic, process-local repository used in memory/offline mode and unit tests. */
export class MemoryCommerceRepository implements CommerceRepository {
  private readonly catalog: CommerceCatalogRecord[];
  private readonly orders = new Map<string, CommerceOrderRecord>();
  private readonly orderByIdempotency = new Map<string, string>();
  private readonly subscriptions = new Map<string, CommerceSubscriptionRecord>();
  private readonly entitlements = new Map<string, StoredEntitlement>();
  private readonly entitlementsByKey = new Map<string, string>();
  private readonly referrals = new Map<string, CommerceReferralRecord>();
  private readonly referralsByDedupe = new Map<string, string>();
  private readonly tips = new Map<string, CommerceTipRecord>();
  private readonly tipsByIdempotency = new Map<string, string>();
  private readonly paymentEvents = new Map<string, string>();
  private readonly ledger = new Map<string, CommerceLedgerEntry>();

  constructor(
    seed: {
      catalog?: readonly CommerceCatalogRecord[];
      entitlements?: readonly StoredEntitlement[];
      orders?: readonly CommerceOrderRecord[];
    } = {}
  ) {
    this.catalog = clone([
      ...new Map((seed.catalog ?? []).map((row) => [row.offer.id, row])).values()
    ]);
    for (const order of seed.orders ?? []) {
      this.orders.set(order.id, clone(order));
      this.orderByIdempotency.set(order.idempotencyKey, order.id);
    }
    for (const stored of seed.entitlements ?? []) this.storeEntitlement(stored);
  }

  async listCatalog(): Promise<CommerceCatalogRecord[]> {
    return clone(this.catalog);
  }

  async findOffer(offerId: string): Promise<CommerceCatalogRecord | null> {
    const row = this.catalog.find((candidate) => candidate.offer.id === offerId);
    return row ? clone(row) : null;
  }

  async createOrder(order: CommerceOrderRecord): Promise<CommerceOrderRecord> {
    const existingId = this.orderByIdempotency.get(order.idempotencyKey);
    if (existingId) {
      const existing = this.orders.get(existingId)!;
      if (existing.userId !== order.userId || existing.offerId !== order.offerId) {
        throw new Error("Commerce idempotency key was reused for a different order");
      }
      return clone(existing);
    }
    this.orders.set(order.id, clone(order));
    this.orderByIdempotency.set(order.idempotencyKey, order.id);
    return clone(order);
  }

  async findOrder(orderId: string): Promise<CommerceOrderRecord | null> {
    const row = this.orders.get(orderId);
    return row ? clone(row) : null;
  }

  async listEntitlements(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string
  ): Promise<StoredEntitlement[]> {
    return [...this.entitlements.values()]
      .filter(
        (row) => row.document.subject.type === subjectType && row.document.subject.id === subjectId
      )
      .sort((left, right) => left.document.id.localeCompare(right.document.id))
      .map(clone);
  }

  async findEntitlement(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string,
    productType: EntitlementV2["product"]["type"],
    productId: string
  ): Promise<StoredEntitlement | null> {
    const id = this.entitlementsByKey.get(
      entitlementKey(subjectType, subjectId, productType, productId)
    );
    return id ? clone(this.entitlements.get(id)!) : null;
  }

  async createReferral(referral: CommerceReferralRecord): Promise<CommerceReferralRecord> {
    const existingId = this.referralsByDedupe.get(referral.dedupeKey);
    if (existingId) return clone(this.referrals.get(existingId)!);
    this.referrals.set(referral.id, clone(referral));
    this.referralsByDedupe.set(referral.dedupeKey, referral.id);
    return clone(referral);
  }

  async findReferral(referralId: string): Promise<CommerceReferralRecord | null> {
    const row = this.referrals.get(referralId);
    return row ? clone(row) : null;
  }

  async createTip(tip: CommerceTipRecord): Promise<CommerceTipRecord> {
    const existingId = this.tipsByIdempotency.get(tip.idempotencyKey);
    if (existingId) {
      const existing = this.tips.get(existingId)!;
      if (
        existing.userId !== tip.userId ||
        existing.recipientType !== tip.recipientType ||
        existing.recipientId !== tip.recipientId ||
        existing.amountMinor !== tip.amountMinor ||
        existing.currency !== tip.currency
      ) {
        throw new Error("Commerce idempotency key was reused for a different tip");
      }
      return clone(existing);
    }
    this.tips.set(tip.id, clone(tip));
    this.tipsByIdempotency.set(tip.idempotencyKey, tip.id);
    return clone(tip);
  }

  async findTip(tipId: string): Promise<CommerceTipRecord | null> {
    const row = this.tips.get(tipId);
    return row ? clone(row) : null;
  }

  async applyPaymentEvent(
    event: VerifiedPaymentEvent,
    effect: CommerceEventEffect
  ): Promise<{ duplicate: boolean; ledger: CommerceLedgerEntry | null }> {
    const eventKey = `${event.provider}\u0000${event.providerEventId}`;
    const previousHash = this.paymentEvents.get(eventKey);
    if (previousHash) {
      if (previousHash !== event.payloadHash) {
        throw new Error("Provider event ID was reused with a different payload");
      }
      return { duplicate: true, ledger: null };
    }

    const order = effect.order ? this.orders.get(effect.order.id) : null;
    if (effect.order && !order) throw new Error(`Unknown order ${effect.order.id}`);
    const tip = effect.tip ? this.tips.get(effect.tip.id) : null;
    if (effect.tip && !tip) throw new Error(`Unknown tip ${effect.tip.id}`);
    const referral = effect.referral ? this.referrals.get(effect.referral.id) : null;
    if (effect.referral && !referral) throw new Error(`Unknown referral ${effect.referral.id}`);

    // Process-local writes cannot interleave inside this synchronous critical section.
    this.paymentEvents.set(eventKey, event.payloadHash);
    if (effect.order && order) {
      const status = nextOrderStatus(order.status, effect.order.status);
      this.orders.set(order.id, {
        ...order,
        status,
        paidAt: effect.order.paidAt ?? order.paidAt,
        cancelledAt: effect.order.cancelledAt ?? order.cancelledAt,
        refundedAt: effect.order.refundedAt ?? order.refundedAt,
        updatedAt: event.occurredAt
      });
    }
    if (effect.subscription) {
      const current = this.subscriptions.get(effect.subscription.id);
      this.subscriptions.set(
        effect.subscription.id,
        current
          ? {
              ...clone(effect.subscription),
              status: nextSubscriptionStatus(current.status, effect.subscription.status),
              createdAt: current.createdAt
            }
          : clone(effect.subscription)
      );
    }
    if (effect.entitlement) {
      const current = this.entitlements.get(effect.entitlement.document.id);
      this.storeEntitlement(
        current
          ? {
              ...clone(effect.entitlement),
              document: mergeEntitlement(current.document, effect.entitlement.document)
            }
          : effect.entitlement
      );
    }
    if (effect.tip && tip) {
      this.tips.set(tip.id, {
        ...tip,
        status: nextTipStatus(tip.status, effect.tip.status),
        paidAt: effect.tip.paidAt ?? tip.paidAt,
        refundedAt: effect.tip.refundedAt ?? tip.refundedAt,
        updatedAt: event.occurredAt
      });
    }
    if (effect.referral && referral) {
      this.referrals.set(referral.id, {
        ...referral,
        convertedOrderId: effect.referral.orderId,
        convertedAt: effect.referral.convertedAt,
        payoutStatus: effect.referral.payoutStatus
      });
    }
    const ledger: CommerceLedgerEntry = {
      ...clone(effect.ledger),
      paymentEventId: `memory:${event.provider}:${event.providerEventId}`
    };
    if (!this.ledger.has(ledger.operationKey)) this.ledger.set(ledger.operationKey, ledger);
    return { duplicate: false, ledger: clone(this.ledger.get(ledger.operationKey)!) };
  }

  async reconcile(at: Date): Promise<CommerceReconciliationResult> {
    const startedAt = at.toISOString();
    const discrepancies: Array<{ code: string; id: string }> = [];
    let checkedCount = 0;
    let repairedCount = 0;

    for (const stored of [...this.entitlements.values()]) {
      checkedCount += 1;
      const endsAt = stored.document.endsAt ? Date.parse(stored.document.endsAt) : null;
      if (
        endsAt !== null &&
        endsAt <= at.getTime() &&
        (stored.document.status === "active" || stored.document.status === "grace")
      ) {
        discrepancies.push({ code: "expired-entitlement-active", id: stored.document.id });
        const updated = clone(stored);
        updated.document.status = "expired";
        updated.document.updatedAt = startedAt;
        this.storeEntitlement(updated);
        const operationKey = `reconcile:expire:${stored.document.id}:${stored.document.endsAt}`;
        if (!this.ledger.has(operationKey)) {
          this.ledger.set(operationKey, {
            id: hashId("ledger", operationKey),
            operationKey,
            paymentEventId: null,
            orderId: stored.orderId,
            subscriptionId: stored.subscriptionId,
            entitlementId: stored.document.id,
            entryType: "expire",
            effectiveAt: stored.document.endsAt!,
            reason: "entitlement-period-ended",
            metadata: {},
            createdAt: startedAt
          });
          repairedCount += 1;
        }
      }
    }

    for (const order of this.orders.values()) {
      if (order.status !== "paid") continue;
      checkedCount += 1;
      const bundle = this.catalog.find((row) => row.offer.id === order.offerId);
      if (!bundle) continue;
      if (bundle.offer.billingUnit === "month" || bundle.offer.billingUnit === "year") continue;
      const key = entitlementKey("user", order.userId, bundle.product.type, bundle.product.id);
      if (this.entitlementsByKey.has(key)) continue;
      discrepancies.push({ code: "paid-order-missing-entitlement", id: order.id });
      const id = hashId(
        "ent",
        `${bundle.product.type}\u0000${bundle.product.id}\u0000user\u0000${order.userId}`
      );
      this.storeEntitlement({
        userId: order.userId,
        orderId: order.id,
        subscriptionId: null,
        document: {
          schema: "mapos.entitlement",
          schemaVersion: MAPOS_V2_SCHEMA_VERSION,
          id,
          subject: { type: "user", id: order.userId },
          product: {
            type: bundle.product.type,
            id: bundle.product.id,
            providerId: bundle.product.providerId
          },
          status: "active",
          grants: clone(bundle.offer.grants),
          source: { provider: "mapos", externalTransactionId: order.providerOrderId },
          startsAt: order.paidAt ?? order.updatedAt,
          endsAt: null,
          metadata: { reconciled: true },
          createdAt: startedAt,
          updatedAt: startedAt
        }
      });
      repairedCount += 1;
    }

    return {
      id: `reconciliation:${startedAt}`,
      provider: "none",
      checkedCount,
      repairedCount,
      discrepancies,
      startedAt,
      finishedAt: startedAt
    };
  }

  /** Test-only evidence accessor; production code has no mutable client ledger API. */
  ledgerEntries(): CommerceLedgerEntry[] {
    return [...this.ledger.values()].map(clone);
  }

  private storeEntitlement(stored: StoredEntitlement): void {
    const copy = clone(stored);
    this.entitlements.set(copy.document.id, copy);
    this.entitlementsByKey.set(
      entitlementKey(
        copy.document.subject.type,
        copy.document.subject.id,
        copy.document.product.type,
        copy.document.product.id
      ),
      copy.document.id
    );
  }
}
