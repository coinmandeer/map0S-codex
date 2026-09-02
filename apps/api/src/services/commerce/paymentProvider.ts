import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  CommerceOrderRecord,
  CommerceTipRecord,
  VerifiedPaymentEvent
} from "./commerceRepository.js";

export interface ProviderCheckoutSession {
  providerOrderId: string;
  sessionId: string;
  /** Synthetic mode has no external navigation target. */
  checkoutUrl: string | null;
  synthetic: boolean;
}

export interface PaymentProviderAdapter {
  readonly id: Exclude<CommerceOrderRecord["provider"], "none">;
  readonly synthetic: boolean;
  createCheckoutSession(input: {
    order: CommerceOrderRecord;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;
  createTipSession(input: {
    tip: CommerceTipRecord;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;
  verifyWebhook(payload: unknown, signature: string | undefined): VerifiedPaymentEvent;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new Error("Unknown webhook field");
}

const TYPES = new Set<VerifiedPaymentEvent["type"]>([
  "order.paid",
  "order.cancelled",
  "order.refunded",
  "subscription.active",
  "subscription.past_due",
  "subscription.cancel_at_period_end",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.refunded",
  "tip.paid",
  "tip.refunded"
]);

/** Offline-only adapter. It never contacts a provider and requires an explicit HMAC secret. */
export class SyntheticPaymentProvider implements PaymentProviderAdapter {
  readonly id = "synthetic" as const;
  readonly synthetic = true;

  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("Synthetic commerce secret must be at least 32 bytes");
  }

  async createCheckoutSession(input: {
    order: CommerceOrderRecord;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession> {
    const digest = createHash("sha256")
      .update(`order\u0000${input.order.id}\u0000${input.idempotencyKey}`)
      .digest("hex")
      .slice(0, 24);
    return {
      providerOrderId: `synthetic-order-${digest}`,
      sessionId: `synthetic-session-${digest}`,
      checkoutUrl: null,
      synthetic: true
    };
  }

  async createTipSession(input: {
    tip: CommerceTipRecord;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession> {
    const digest = createHash("sha256")
      .update(`tip\u0000${input.tip.id}\u0000${input.idempotencyKey}`)
      .digest("hex")
      .slice(0, 24);
    return {
      providerOrderId: `synthetic-tip-${digest}`,
      sessionId: `synthetic-tip-session-${digest}`,
      checkoutUrl: null,
      synthetic: true
    };
  }

  verifyWebhook(payload: unknown, signature: string | undefined): VerifiedPaymentEvent {
    if (!record(payload)) throw new Error("Invalid synthetic webhook payload");
    exactKeys(payload, ["id", "type", "occurredAt", "data"]);
    const serialized = stableJson(payload);
    if (Buffer.byteLength(serialized, "utf8") > 128 * 1024) {
      throw new Error("Synthetic webhook payload is too large");
    }
    const expected = this.signature(payload);
    const received = signature?.startsWith("sha256=") ? signature.slice(7) : "";
    const expectedBytes = Buffer.from(expected, "hex");
    const receivedBytes = /^[a-f0-9]{64}$/i.test(received)
      ? Buffer.from(received, "hex")
      : Buffer.alloc(0);
    if (
      receivedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(expectedBytes, receivedBytes)
    ) {
      throw new Error("Invalid synthetic webhook signature");
    }

    const providerEventId = text(payload.id, "event id");
    const type = text(payload.type, "event type") as VerifiedPaymentEvent["type"];
    if (!TYPES.has(type)) throw new Error("Unsupported synthetic webhook event type");
    const occurredAt = text(payload.occurredAt, "occurredAt");
    if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Invalid occurredAt");
    const data = payload.data;
    if (!record(data)) throw new Error("Invalid webhook data");
    exactKeys(data, [
      "orderId",
      "subscriptionId",
      "tipId",
      "periodStart",
      "periodEnd",
      "graceEndsAt"
    ]);
    const orderEvent = type.startsWith("order.") || type.startsWith("subscription.");
    const tipEvent = type.startsWith("tip.");
    if (orderEvent && data.tipId !== undefined) throw new Error("Order event contains tip data");
    if (tipEvent && Object.keys(data).some((key) => key !== "tipId")) {
      throw new Error("Tip event contains order data");
    }
    if (type.startsWith("subscription.") && typeof data.subscriptionId !== "string") {
      throw new Error("Subscription event has no subscriptionId");
    }
    const orderId = orderEvent ? text(data.orderId, "orderId") : undefined;
    const tipId = tipEvent ? text(data.tipId, "tipId") : undefined;
    const optionalDate = (key: string): string | null | undefined => {
      const value = data[key];
      if (value === undefined || value === null) return value;
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(`Invalid ${key}`);
      }
      return value;
    };
    return {
      provider: "synthetic",
      providerEventId,
      type,
      occurredAt: new Date(occurredAt).toISOString(),
      payloadHash: createHash("sha256").update(serialized).digest("hex"),
      payload: structuredClone(payload),
      ...(orderId ? { orderId } : {}),
      ...(tipId ? { tipId } : {}),
      ...(typeof data.subscriptionId === "string" ? { subscriptionId: data.subscriptionId } : {}),
      periodStart: optionalDate("periodStart"),
      periodEnd: optionalDate("periodEnd"),
      graceEndsAt: optionalDate("graceEndsAt")
    };
  }

  /** Used by deterministic contract tests and local fixture tooling only. */
  signature(payload: unknown): string {
    return createHmac("sha256", this.secret).update(stableJson(payload)).digest("hex");
  }
}
