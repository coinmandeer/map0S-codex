import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, sql as dsql } from "drizzle-orm";
import type { EntitlementV2 } from "@mapos/layer-sdk";
import { db } from "../../db/index.js";
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
} from "../../db/schema.js";
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

type OrderRow = typeof commerceOrders.$inferSelect;
type EntitlementRow = typeof commerceEntitlements.$inferSelect;
type ReferralRow = typeof commerceReferrals.$inferSelect;
type TipRow = typeof commerceTips.$inferSelect;
type LedgerRow = typeof commerceLedgerEntries.$inferSelect;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function hashId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 48)}`;
}

function order(row: OrderRow): CommerceOrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    offerId: row.offerId,
    status: row.status as CommerceOrderRecord["status"],
    provider: row.provider as CommerceOrderRecord["provider"],
    providerOrderId: row.providerOrderId,
    idempotencyKey: row.idempotencyKey,
    amountMinor: row.amountMinor,
    currency: row.currency,
    referralId: row.referralId,
    createdAt: row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
    cancelledAt: iso(row.cancelledAt),
    refundedAt: iso(row.refundedAt),
    updatedAt: row.updatedAt.toISOString()
  };
}

function entitlementDocument(row: EntitlementRow): EntitlementV2 {
  return {
    schema: "mapos.entitlement",
    schemaVersion: "2.0.0",
    id: row.id,
    subject: {
      type: row.subjectType as EntitlementV2["subject"]["type"],
      id: row.subjectId
    },
    product: {
      type: row.productType as EntitlementV2["product"]["type"],
      id: row.productId,
      providerId: row.productProviderId
    },
    status: row.status as EntitlementV2["status"],
    grants: structuredClone(row.grants),
    source: row.sourceProvider
      ? {
          provider: row.sourceProvider as NonNullable<EntitlementV2["source"]>["provider"],
          externalCustomerId: row.externalCustomerId,
          externalTransactionId: row.externalTransactionId,
          referralId: row.referralId
        }
      : undefined,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    metadata: structuredClone(row.metadata) as EntitlementV2["metadata"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function storedEntitlement(row: EntitlementRow): StoredEntitlement {
  return {
    document: entitlementDocument(row),
    userId: row.userId,
    orderId: row.orderId,
    subscriptionId: row.subscriptionId
  };
}

function entitlementValues(stored: StoredEntitlement): typeof commerceEntitlements.$inferInsert {
  const value = stored.document;
  return {
    id: value.id,
    userId: stored.userId,
    subjectType: value.subject.type,
    subjectId: value.subject.id,
    productType: value.product.type,
    productId: value.product.id,
    productProviderId: value.product.providerId ?? null,
    status: value.status,
    grants: value.grants,
    sourceProvider: value.source?.provider ?? null,
    externalCustomerId: value.source?.externalCustomerId ?? null,
    externalTransactionId: value.source?.externalTransactionId ?? null,
    referralId: value.source?.referralId ?? null,
    orderId: stored.orderId,
    subscriptionId: stored.subscriptionId,
    startsAt: value.startsAt ? new Date(value.startsAt) : null,
    endsAt: value.endsAt ? new Date(value.endsAt) : null,
    metadata: value.metadata ?? {},
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt)
  };
}

function referral(row: ReferralRow): CommerceReferralRecord {
  return {
    id: row.id,
    campaign: row.campaign,
    partnerId: row.partnerId,
    source: row.source,
    sessionHash: row.sessionHash,
    dedupeKey: row.dedupeKey,
    clickedAt: row.clickedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consentedAt: iso(row.consentedAt),
    privacyBasis: row.privacyBasis,
    convertedOrderId: row.convertedOrderId,
    convertedAt: iso(row.convertedAt),
    payoutStatus: row.payoutStatus as CommerceReferralRecord["payoutStatus"],
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString()
  };
}

function tip(row: TipRow): CommerceTipRecord {
  return {
    id: row.id,
    userId: row.userId,
    recipientType: row.recipientType as CommerceTipRecord["recipientType"],
    recipientId: row.recipientId,
    provider: row.provider as CommerceTipRecord["provider"],
    network: row.network,
    amountMinor: row.amountMinor,
    feeMinor: row.feeMinor,
    currency: row.currency,
    status: row.status as CommerceTipRecord["status"],
    providerTransactionId: row.providerTransactionId,
    idempotencyKey: row.idempotencyKey,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
    refundedAt: iso(row.refundedAt),
    updatedAt: row.updatedAt.toISOString()
  };
}

function ledger(row: LedgerRow): CommerceLedgerEntry {
  return {
    id: row.id,
    operationKey: row.operationKey,
    paymentEventId: row.paymentEventId,
    orderId: row.orderId,
    subscriptionId: row.subscriptionId,
    entitlementId: row.entitlementId,
    entryType: row.entryType as CommerceLedgerEntry["entryType"],
    effectiveAt: row.effectiveAt.toISOString(),
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString()
  };
}

function subscriptionValues(value: CommerceSubscriptionRecord) {
  return {
    id: value.id,
    userId: value.userId,
    offerId: value.offerId,
    status: value.status,
    provider: value.provider,
    providerSubscriptionId: value.providerSubscriptionId,
    currentPeriodStart: value.currentPeriodStart ? new Date(value.currentPeriodStart) : null,
    currentPeriodEnd: value.currentPeriodEnd ? new Date(value.currentPeriodEnd) : null,
    graceEndsAt: value.graceEndsAt ? new Date(value.graceEndsAt) : null,
    cancelAt: value.cancelAt ? new Date(value.cancelAt) : null,
    endedAt: value.endedAt ? new Date(value.endedAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt)
  };
}

export class PostgresCommerceRepository implements CommerceRepository {
  async listCatalog(): Promise<CommerceCatalogRecord[]> {
    const rows = await db
      .select({ useCase: commerceUseCases, product: commerceProducts, offer: commerceOffers })
      .from(commerceOffers)
      .innerJoin(commerceProducts, eq(commerceOffers.productId, commerceProducts.id))
      .innerJoin(commerceUseCases, eq(commerceProducts.useCaseId, commerceUseCases.id))
      .orderBy(asc(commerceProducts.id), asc(commerceOffers.id));
    return rows.map(({ useCase, product: productRow, offer }) => ({
      contract: {
        ...structuredClone(useCase.contract),
        status: useCase.status as CommerceCatalogRecord["contract"]["status"],
        realProviderApproved: useCase.realProviderApproved,
        approvedAt: iso(useCase.approvedAt)
      },
      product: {
        id: productRow.id,
        useCaseId: productRow.useCaseId,
        type: productRow.type as CommerceCatalogRecord["product"]["type"],
        providerId: productRow.providerId,
        name: productRow.name,
        description: productRow.description,
        publicMetadata: structuredClone(productRow.publicMetadata),
        status: productRow.status as CommerceCatalogRecord["product"]["status"],
        createdAt: productRow.createdAt.toISOString(),
        updatedAt: productRow.updatedAt.toISOString()
      },
      offer: {
        id: offer.id,
        productId: offer.productId,
        billingUnit: offer.billingUnit as CommerceCatalogRecord["offer"]["billingUnit"],
        amountMinor: offer.amountMinor,
        currency: offer.currency,
        grants: structuredClone(offer.grants),
        periodCount: offer.periodCount,
        status: offer.status as CommerceCatalogRecord["offer"]["status"],
        providerPriceId: offer.providerPriceId,
        createdAt: offer.createdAt.toISOString(),
        updatedAt: offer.updatedAt.toISOString()
      }
    }));
  }

  async findOffer(offerId: string): Promise<CommerceCatalogRecord | null> {
    return (await this.listCatalog()).find((row) => row.offer.id === offerId) ?? null;
  }

  async createOrder(value: CommerceOrderRecord): Promise<CommerceOrderRecord> {
    const [inserted] = await db
      .insert(commerceOrders)
      .values({
        id: value.id,
        userId: value.userId,
        offerId: value.offerId,
        status: value.status,
        provider: value.provider,
        providerOrderId: value.providerOrderId,
        idempotencyKey: value.idempotencyKey,
        amountMinor: value.amountMinor,
        currency: value.currency,
        referralId: value.referralId,
        createdAt: new Date(value.createdAt),
        paidAt: null,
        cancelledAt: null,
        refundedAt: null,
        updatedAt: new Date(value.updatedAt)
      })
      .onConflictDoNothing({ target: commerceOrders.idempotencyKey })
      .returning();
    const row =
      inserted ??
      (
        await db
          .select()
          .from(commerceOrders)
          .where(eq(commerceOrders.idempotencyKey, value.idempotencyKey))
          .limit(1)
      )[0];
    if (!row) throw new Error("Order idempotency lookup failed");
    if (row.userId !== value.userId || row.offerId !== value.offerId) {
      throw new Error("Commerce idempotency key was reused for a different order");
    }
    return order(row);
  }

  async findOrder(orderId: string): Promise<CommerceOrderRecord | null> {
    const [row] = await db
      .select()
      .from(commerceOrders)
      .where(eq(commerceOrders.id, orderId))
      .limit(1);
    return row ? order(row) : null;
  }

  async listEntitlements(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string
  ): Promise<StoredEntitlement[]> {
    const rows = await db
      .select()
      .from(commerceEntitlements)
      .where(
        and(
          eq(commerceEntitlements.subjectType, subjectType),
          eq(commerceEntitlements.subjectId, subjectId)
        )
      )
      .orderBy(asc(commerceEntitlements.id));
    return rows.map(storedEntitlement);
  }

  async findEntitlement(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string,
    productType: EntitlementV2["product"]["type"],
    productId: string
  ): Promise<StoredEntitlement | null> {
    const [row] = await db
      .select()
      .from(commerceEntitlements)
      .where(
        and(
          eq(commerceEntitlements.subjectType, subjectType),
          eq(commerceEntitlements.subjectId, subjectId),
          eq(commerceEntitlements.productType, productType),
          eq(commerceEntitlements.productId, productId)
        )
      )
      .limit(1);
    return row ? storedEntitlement(row) : null;
  }

  async createReferral(value: CommerceReferralRecord): Promise<CommerceReferralRecord> {
    const [inserted] = await db
      .insert(commerceReferrals)
      .values({
        ...value,
        clickedAt: new Date(value.clickedAt),
        expiresAt: new Date(value.expiresAt),
        consentedAt: value.consentedAt ? new Date(value.consentedAt) : null,
        convertedAt: value.convertedAt ? new Date(value.convertedAt) : null,
        createdAt: new Date(value.createdAt)
      })
      .onConflictDoNothing({ target: commerceReferrals.dedupeKey })
      .returning();
    const row =
      inserted ??
      (
        await db
          .select()
          .from(commerceReferrals)
          .where(eq(commerceReferrals.dedupeKey, value.dedupeKey))
          .limit(1)
      )[0];
    if (!row) throw new Error("Referral idempotency lookup failed");
    return referral(row);
  }

  async findReferral(referralId: string): Promise<CommerceReferralRecord | null> {
    const [row] = await db
      .select()
      .from(commerceReferrals)
      .where(eq(commerceReferrals.id, referralId))
      .limit(1);
    return row ? referral(row) : null;
  }

  async createTip(value: CommerceTipRecord): Promise<CommerceTipRecord> {
    const [inserted] = await db
      .insert(commerceTips)
      .values({
        ...value,
        createdAt: new Date(value.createdAt),
        paidAt: value.paidAt ? new Date(value.paidAt) : null,
        refundedAt: value.refundedAt ? new Date(value.refundedAt) : null,
        updatedAt: new Date(value.updatedAt)
      })
      .onConflictDoNothing({ target: commerceTips.idempotencyKey })
      .returning();
    const row =
      inserted ??
      (
        await db
          .select()
          .from(commerceTips)
          .where(eq(commerceTips.idempotencyKey, value.idempotencyKey))
          .limit(1)
      )[0];
    if (!row) throw new Error("Tip idempotency lookup failed");
    if (
      row.userId !== value.userId ||
      row.recipientId !== value.recipientId ||
      row.amountMinor !== value.amountMinor ||
      row.currency !== value.currency
    ) {
      throw new Error("Commerce idempotency key was reused for a different tip");
    }
    return tip(row);
  }

  async findTip(tipId: string): Promise<CommerceTipRecord | null> {
    const [row] = await db.select().from(commerceTips).where(eq(commerceTips.id, tipId)).limit(1);
    return row ? tip(row) : null;
  }

  async applyPaymentEvent(
    event: VerifiedPaymentEvent,
    effect: CommerceEventEffect
  ): Promise<{ duplicate: boolean; ledger: CommerceLedgerEntry | null }> {
    return db.transaction(async (transaction) => {
      const [paymentEvent] = await transaction
        .insert(commercePaymentEvents)
        .values({
          provider: event.provider,
          providerEventId: event.providerEventId,
          type: event.type,
          payloadHash: event.payloadHash,
          payload: event.payload,
          signatureVerified: true,
          occurredAt: new Date(event.occurredAt),
          processedAt: null,
          outcome: "received"
        })
        .onConflictDoNothing({
          target: [commercePaymentEvents.provider, commercePaymentEvents.providerEventId]
        })
        .returning({ id: commercePaymentEvents.id });
      if (!paymentEvent) {
        const [existingEvent] = await transaction
          .select({ payloadHash: commercePaymentEvents.payloadHash })
          .from(commercePaymentEvents)
          .where(
            and(
              eq(commercePaymentEvents.provider, event.provider),
              eq(commercePaymentEvents.providerEventId, event.providerEventId)
            )
          )
          .limit(1);
        if (!existingEvent || existingEvent.payloadHash !== event.payloadHash) {
          throw new Error("Provider event ID was reused with a different payload");
        }
        return { duplicate: true, ledger: null };
      }

      const lockId = effect.order?.id ?? effect.tip?.id ?? effect.ledger.operationKey;
      await transaction.execute(dsql`SELECT pg_advisory_xact_lock(hashtextextended(${lockId}, 0))`);

      if (effect.order) {
        const [current] = await transaction
          .select()
          .from(commerceOrders)
          .where(eq(commerceOrders.id, effect.order.id))
          .limit(1);
        if (!current) throw new Error(`Unknown order ${effect.order.id}`);
        await transaction
          .update(commerceOrders)
          .set({
            status: nextOrderStatus(
              current.status as CommerceOrderRecord["status"],
              effect.order.status
            ),
            paidAt: effect.order.paidAt ? new Date(effect.order.paidAt) : current.paidAt,
            cancelledAt: effect.order.cancelledAt
              ? new Date(effect.order.cancelledAt)
              : current.cancelledAt,
            refundedAt: effect.order.refundedAt
              ? new Date(effect.order.refundedAt)
              : current.refundedAt,
            updatedAt: new Date(event.occurredAt)
          })
          .where(eq(commerceOrders.id, current.id));
      }

      if (effect.subscription) {
        const [current] = await transaction
          .select()
          .from(commerceSubscriptions)
          .where(eq(commerceSubscriptions.id, effect.subscription.id))
          .limit(1);
        const next = current
          ? {
              ...effect.subscription,
              status: nextSubscriptionStatus(
                current.status as CommerceSubscriptionRecord["status"],
                effect.subscription.status
              ),
              createdAt: current.createdAt.toISOString()
            }
          : effect.subscription;
        const values = subscriptionValues(next);
        await transaction
          .insert(commerceSubscriptions)
          .values(values)
          .onConflictDoUpdate({
            target: commerceSubscriptions.id,
            set: {
              status: values.status,
              currentPeriodStart: values.currentPeriodStart,
              currentPeriodEnd: values.currentPeriodEnd,
              graceEndsAt: values.graceEndsAt,
              cancelAt: values.cancelAt,
              endedAt: values.endedAt,
              updatedAt: values.updatedAt
            }
          });
      }

      if (effect.entitlement) {
        const [current] = await transaction
          .select()
          .from(commerceEntitlements)
          .where(eq(commerceEntitlements.id, effect.entitlement.document.id))
          .limit(1);
        const merged = current
          ? {
              ...effect.entitlement,
              document: mergeEntitlement(entitlementDocument(current), effect.entitlement.document)
            }
          : effect.entitlement;
        const values = entitlementValues(merged);
        await transaction
          .insert(commerceEntitlements)
          .values(values)
          .onConflictDoUpdate({
            target: commerceEntitlements.id,
            set: {
              status: values.status,
              grants: values.grants,
              startsAt: values.startsAt,
              endsAt: values.endsAt,
              metadata: values.metadata,
              orderId: values.orderId,
              subscriptionId: values.subscriptionId,
              externalTransactionId: values.externalTransactionId,
              referralId: values.referralId,
              updatedAt: values.updatedAt
            }
          });
      }

      if (effect.tip) {
        const [current] = await transaction
          .select()
          .from(commerceTips)
          .where(eq(commerceTips.id, effect.tip.id))
          .limit(1);
        if (!current) throw new Error(`Unknown tip ${effect.tip.id}`);
        await transaction
          .update(commerceTips)
          .set({
            status: nextTipStatus(current.status as CommerceTipRecord["status"], effect.tip.status),
            paidAt: effect.tip.paidAt ? new Date(effect.tip.paidAt) : current.paidAt,
            refundedAt: effect.tip.refundedAt
              ? new Date(effect.tip.refundedAt)
              : current.refundedAt,
            updatedAt: new Date(event.occurredAt)
          })
          .where(eq(commerceTips.id, current.id));
      }

      if (effect.referral) {
        const [current] = await transaction
          .select()
          .from(commerceReferrals)
          .where(eq(commerceReferrals.id, effect.referral.id))
          .limit(1);
        if (!current) throw new Error(`Unknown referral ${effect.referral.id}`);
        if (current.convertedOrderId && current.convertedOrderId !== effect.referral.orderId) {
          throw new Error("Referral is already attributed to another order");
        }
        await transaction
          .update(commerceReferrals)
          .set({
            convertedOrderId: effect.referral.orderId,
            convertedAt: effect.referral.convertedAt
              ? new Date(effect.referral.convertedAt)
              : current.convertedAt,
            payoutStatus: effect.referral.payoutStatus
          })
          .where(eq(commerceReferrals.id, current.id));
      }

      const [insertedLedger] = await transaction
        .insert(commerceLedgerEntries)
        .values({
          ...effect.ledger,
          paymentEventId: paymentEvent.id,
          effectiveAt: new Date(effect.ledger.effectiveAt),
          createdAt: new Date(effect.ledger.createdAt)
        })
        .onConflictDoNothing({ target: commerceLedgerEntries.operationKey })
        .returning();
      const storedLedger =
        insertedLedger ??
        (
          await transaction
            .select()
            .from(commerceLedgerEntries)
            .where(eq(commerceLedgerEntries.operationKey, effect.ledger.operationKey))
            .limit(1)
        )[0];
      await transaction
        .update(commercePaymentEvents)
        .set({ outcome: "applied", processedAt: new Date() })
        .where(eq(commercePaymentEvents.id, paymentEvent.id));
      return { duplicate: false, ledger: storedLedger ? ledger(storedLedger) : null };
    });
  }

  async reconcile(at: Date): Promise<CommerceReconciliationResult> {
    return db.transaction(async (transaction) => {
      await transaction.execute(
        dsql`SELECT pg_advisory_xact_lock(hashtextextended('mapos-commerce-reconcile', 0))`
      );
      const startedAt = at.toISOString();
      const expired = await transaction
        .select()
        .from(commerceEntitlements)
        .where(
          and(
            inArray(commerceEntitlements.status, ["active", "grace"]),
            lte(commerceEntitlements.endsAt, at)
          )
        )
        .limit(500);
      const discrepancies: Array<{ code: string; id: string }> = [];
      let checkedCount = expired.length;
      let repairedCount = 0;
      for (const row of expired) {
        discrepancies.push({ code: "expired-entitlement-active", id: row.id });
        await transaction
          .update(commerceEntitlements)
          .set({ status: "expired", updatedAt: at })
          .where(eq(commerceEntitlements.id, row.id));
        const operationKey = `reconcile:expire:${row.id}:${row.endsAt!.toISOString()}`;
        const inserted = await transaction
          .insert(commerceLedgerEntries)
          .values({
            id: hashId("ledger", operationKey),
            operationKey,
            paymentEventId: null,
            orderId: row.orderId,
            subscriptionId: row.subscriptionId,
            entitlementId: row.id,
            entryType: "expire",
            effectiveAt: row.endsAt!,
            reason: "entitlement-period-ended",
            metadata: {},
            createdAt: at
          })
          .onConflictDoNothing({ target: commerceLedgerEntries.operationKey })
          .returning({ id: commerceLedgerEntries.id });
        repairedCount += inserted.length;
      }
      const paidOrders = await transaction
        .select({ order: commerceOrders, offer: commerceOffers, product: commerceProducts })
        .from(commerceOrders)
        .innerJoin(commerceOffers, eq(commerceOrders.offerId, commerceOffers.id))
        .innerJoin(commerceProducts, eq(commerceOffers.productId, commerceProducts.id))
        .innerJoin(commerceUseCases, eq(commerceProducts.useCaseId, commerceUseCases.id))
        .where(
          and(
            eq(commerceOrders.status, "paid"),
            inArray(commerceOffers.billingUnit, ["one-time", "usage"]),
            eq(commerceOffers.status, "active"),
            eq(commerceProducts.status, "active"),
            eq(commerceUseCases.status, "approved")
          )
        )
        .limit(500);
      checkedCount += paidOrders.length;
      for (const row of paidOrders) {
        const [existing] = await transaction
          .select({ id: commerceEntitlements.id })
          .from(commerceEntitlements)
          .where(
            and(
              eq(commerceEntitlements.subjectType, "user"),
              eq(commerceEntitlements.subjectId, row.order.userId),
              eq(commerceEntitlements.productType, row.product.type),
              eq(commerceEntitlements.productId, row.product.id)
            )
          )
          .limit(1);
        if (existing) continue;
        discrepancies.push({ code: "paid-order-missing-entitlement", id: row.order.id });
        const entitlementId = hashId(
          "ent",
          `${row.product.type}\u0000${row.product.id}\u0000user\u0000${row.order.userId}`
        );
        const startsAt = row.order.paidAt ?? row.order.updatedAt;
        const [insertedEntitlement] = await transaction
          .insert(commerceEntitlements)
          .values({
            id: entitlementId,
            userId: row.order.userId,
            subjectType: "user",
            subjectId: row.order.userId,
            productType: row.product.type,
            productId: row.product.id,
            productProviderId: row.product.providerId,
            status: "active",
            grants: row.offer.grants,
            sourceProvider: "mapos",
            externalCustomerId: null,
            externalTransactionId: row.order.providerOrderId,
            referralId: row.order.referralId,
            orderId: row.order.id,
            subscriptionId: null,
            startsAt,
            endsAt: null,
            metadata: { reconciled: true },
            createdAt: at,
            updatedAt: at
          })
          .onConflictDoNothing({ target: commerceEntitlements.id })
          .returning({ id: commerceEntitlements.id });
        if (!insertedEntitlement) continue;
        const operationKey = `reconcile:grant:${row.order.id}:${entitlementId}`;
        await transaction
          .insert(commerceLedgerEntries)
          .values({
            id: hashId("ledger", operationKey),
            operationKey,
            paymentEventId: null,
            orderId: row.order.id,
            subscriptionId: null,
            entitlementId,
            entryType: "reconcile",
            effectiveAt: startsAt,
            reason: "paid-order-missing-entitlement",
            metadata: {},
            createdAt: at
          })
          .onConflictDoNothing({ target: commerceLedgerEntries.operationKey });
        repairedCount += 1;
      }
      const [run] = await transaction
        .insert(commerceReconciliationRuns)
        .values({
          provider: "none",
          status: "complete",
          checkedCount,
          repairedCount,
          discrepancies,
          startedAt: at,
          finishedAt: at
        })
        .returning({ id: commerceReconciliationRuns.id });
      return {
        id: run!.id,
        provider: "none",
        checkedCount,
        repairedCount,
        discrepancies,
        startedAt,
        finishedAt: startedAt
      };
    });
  }
}

export const postgresCommerceRepository = new PostgresCommerceRepository();
