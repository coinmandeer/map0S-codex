import type {
  CommerceBillingUnitV2,
  CommerceUseCaseContractV2,
  EntitlementGrantV2,
  EntitlementV2
} from "@mapos/layer-sdk";

/** Real identifiers are modelled, but current runtime configuration can select only synthetic. */
export type CommerceProvider = "none" | "synthetic" | "stripe" | "crypto" | "external";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded" | "failed";
export type SubscriptionStatus =
  | "trial"
  | "pending"
  | "active"
  | "past_due"
  | "cancel_at_period_end"
  | "cancelled"
  | "expired"
  | "refunded";
export type TipStatus = "pending" | "paid" | "refunded" | "failed";

export interface CommerceProductRecord {
  id: string;
  useCaseId: string;
  type: EntitlementV2["product"]["type"];
  providerId: string | null;
  name: string;
  description: string | null;
  /** This is the only product metadata that unauthenticated catalog routes may return. */
  publicMetadata: Record<string, unknown>;
  status: "draft" | "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface CommerceOfferRecord {
  id: string;
  productId: string;
  billingUnit: CommerceBillingUnitV2;
  amountMinor: number;
  currency: string;
  grants: EntitlementGrantV2[];
  periodCount: number;
  status: "draft" | "active" | "disabled";
  providerPriceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceCatalogRecord {
  contract: CommerceUseCaseContractV2;
  product: CommerceProductRecord;
  offer: CommerceOfferRecord;
}

export interface CommerceOrderRecord {
  id: string;
  userId: string;
  offerId: string;
  status: OrderStatus;
  provider: CommerceProvider;
  providerOrderId: string | null;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  referralId: string | null;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  updatedAt: string;
}

export interface CommerceSubscriptionRecord {
  id: string;
  userId: string;
  offerId: string;
  status: SubscriptionStatus;
  provider: CommerceProvider;
  providerSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredEntitlement {
  document: EntitlementV2;
  userId: string | null;
  orderId: string | null;
  subscriptionId: string | null;
}

export interface CommerceReferralRecord {
  id: string;
  campaign: string;
  partnerId: string;
  source: string;
  sessionHash: string;
  dedupeKey: string;
  clickedAt: string;
  expiresAt: string;
  consentedAt: string | null;
  privacyBasis: string;
  convertedOrderId: string | null;
  convertedAt: string | null;
  payoutStatus: "not-applicable" | "pending" | "eligible" | "paid" | "void";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CommerceTipRecord {
  id: string;
  userId: string | null;
  recipientType: "layer-publisher" | "poi-contributor" | "project" | "community-organization";
  recipientId: string;
  provider: CommerceProvider;
  network: string | null;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  status: TipStatus;
  providerTransactionId: string | null;
  idempotencyKey: string;
  errorCode: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  updatedAt: string;
}

export type PaymentEventType =
  | "order.paid"
  | "order.cancelled"
  | "order.refunded"
  | "subscription.active"
  | "subscription.past_due"
  | "subscription.cancel_at_period_end"
  | "subscription.cancelled"
  | "subscription.expired"
  | "subscription.refunded"
  | "tip.paid"
  | "tip.refunded";

export interface VerifiedPaymentEvent {
  provider: Exclude<CommerceProvider, "none">;
  providerEventId: string;
  type: PaymentEventType;
  occurredAt: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  orderId?: string;
  subscriptionId?: string;
  tipId?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  graceEndsAt?: string | null;
}

export interface CommerceLedgerEntry {
  id: string;
  operationKey: string;
  paymentEventId: string | null;
  orderId: string | null;
  subscriptionId: string | null;
  entitlementId: string | null;
  entryType: "payment" | "grant" | "revoke" | "refund" | "cancel" | "expire" | "reconcile" | "tip";
  effectiveAt: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CommerceEventEffect {
  order?: Pick<CommerceOrderRecord, "id" | "status" | "paidAt" | "cancelledAt" | "refundedAt">;
  subscription?: CommerceSubscriptionRecord;
  entitlement?: StoredEntitlement;
  tip?: Pick<CommerceTipRecord, "id" | "status" | "paidAt" | "refundedAt">;
  referral?: {
    id: string;
    orderId: string;
    convertedAt: string | null;
    payoutStatus: CommerceReferralRecord["payoutStatus"];
  };
  ledger: Omit<CommerceLedgerEntry, "paymentEventId">;
}

export interface CommerceReconciliationResult {
  id: string;
  provider: CommerceProvider;
  checkedCount: number;
  repairedCount: number;
  discrepancies: Array<{ code: string; id: string }>;
  startedAt: string;
  finishedAt: string;
}

export interface CommerceRepository {
  listCatalog(): Promise<CommerceCatalogRecord[]>;
  findOffer(offerId: string): Promise<CommerceCatalogRecord | null>;
  createOrder(order: CommerceOrderRecord): Promise<CommerceOrderRecord>;
  findOrder(orderId: string): Promise<CommerceOrderRecord | null>;
  listEntitlements(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string
  ): Promise<StoredEntitlement[]>;
  findEntitlement(
    subjectType: EntitlementV2["subject"]["type"],
    subjectId: string,
    productType: EntitlementV2["product"]["type"],
    productId: string
  ): Promise<StoredEntitlement | null>;
  createReferral(referral: CommerceReferralRecord): Promise<CommerceReferralRecord>;
  findReferral(referralId: string): Promise<CommerceReferralRecord | null>;
  createTip(tip: CommerceTipRecord): Promise<CommerceTipRecord>;
  findTip(tipId: string): Promise<CommerceTipRecord | null>;
  applyPaymentEvent(
    event: VerifiedPaymentEvent,
    effect: CommerceEventEffect
  ): Promise<{ duplicate: boolean; ledger: CommerceLedgerEntry | null }>;
  reconcile(at: Date): Promise<CommerceReconciliationResult>;
}
