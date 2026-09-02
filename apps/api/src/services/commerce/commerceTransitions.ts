import type { EntitlementStatusV2, EntitlementV2 } from "@mapos/layer-sdk";
import type { OrderStatus, SubscriptionStatus, TipStatus } from "./commerceRepository.js";

const ORDER_TERMINAL = new Set<OrderStatus>(["refunded"]);
const SUBSCRIPTION_TERMINAL = new Set<SubscriptionStatus>(["cancelled", "expired", "refunded"]);

/** Refund is terminal; a late/replayed paid event cannot reopen a refunded order. */
export function nextOrderStatus(current: OrderStatus, requested: OrderStatus): OrderStatus {
  if (ORDER_TERMINAL.has(current)) return current;
  if (requested === "refunded") return "refunded";
  if (current === "paid" && (requested === "cancelled" || requested === "failed")) return current;
  if (current === "cancelled") return current;
  return requested;
}

export function nextSubscriptionStatus(
  current: SubscriptionStatus,
  requested: SubscriptionStatus
): SubscriptionStatus {
  if (current === "refunded" || requested === "refunded") return "refunded";
  if (SUBSCRIPTION_TERMINAL.has(current)) return current;
  return requested;
}

const ENTITLEMENT_TERMINAL = new Set<EntitlementStatusV2>(["refunded"]);

export function nextEntitlementStatus(
  current: EntitlementStatusV2,
  requested: EntitlementStatusV2
): EntitlementStatusV2 {
  if (ENTITLEMENT_TERMINAL.has(current) || requested === "refunded") return "refunded";
  if (
    (current === "expired" || current === "revoked") &&
    (requested === "active" || requested === "grace")
  ) {
    return current;
  }
  return requested;
}

export function nextTipStatus(current: TipStatus, requested: TipStatus): TipStatus {
  if (current === "refunded" || requested === "refunded") return "refunded";
  if (current === "paid" && requested === "failed") return current;
  return requested;
}

export function mergeEntitlement(current: EntitlementV2, requested: EntitlementV2): EntitlementV2 {
  const status = nextEntitlementStatus(current.status, requested.status);
  if (status === current.status && status !== requested.status) return structuredClone(current);
  return { ...structuredClone(requested), status, createdAt: current.createdAt };
}
