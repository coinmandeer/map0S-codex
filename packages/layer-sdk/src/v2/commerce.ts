import { assertCompatibleSchema, type JsonValue, type VersionEnvelope } from "./common.js";

export const ENTITLEMENT_SCHEMA = "mapos.entitlement" as const;

export type CommerceSubjectTypeV2 = "user" | "wallet" | "session" | "organization";
export type CommerceProductTypeV2 =
  "layer" | "layer-bundle" | "subscription" | "content" | "feature" | "world";
export type EntitlementStatusV2 =
  "pending" | "active" | "grace" | "expired" | "revoked" | "refunded";
export type EntitlementGrantV2 =
  "view" | "query" | "detail" | "comment" | "review" | "export" | "collaborate" | "commercial-use";
export type EntitlementSourceProviderV2 =
  "mapos" | "stripe" | "crypto" | "external" | "admin" | "promotion";

export interface EntitlementV2 extends VersionEnvelope {
  schema: typeof ENTITLEMENT_SCHEMA;
  schemaVersion: string;
  subject: { type: CommerceSubjectTypeV2; id: string };
  product: { type: CommerceProductTypeV2; id: string; providerId?: string | null };
  status: EntitlementStatusV2;
  grants: EntitlementGrantV2[];
  source?: {
    provider?: EntitlementSourceProviderV2;
    externalCustomerId?: string | null;
    externalTransactionId?: string | null;
    referralId?: string | null;
  };
  startsAt?: string | null;
  endsAt?: string | null;
  metadata?: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export type CommerceBillingUnitV2 = "one-time" | "month" | "year" | "usage" | "tip";

/**
 * Contract evidence required before a product can become purchasable. This is deliberately
 * provider-neutral: choosing a processor never answers data-rights, refund or support questions.
 */
export interface CommerceUseCaseContractV2 {
  id: string;
  status: "draft" | "approved" | "disabled";
  product: { type: CommerceProductTypeV2; id: string; providerId?: string | null };
  rights: {
    display: boolean;
    cache: boolean;
    export: boolean;
    offline: boolean;
    aiTools: boolean;
    backgroundSync: boolean;
    retentionAfterTermination: boolean;
  };
  authenticationMethod: string;
  billingUnit: CommerceBillingUnitV2;
  referralTerms: string;
  revenueShareTerms: string;
  supportOwner: string;
  refundOwner: string;
  attribution: string;
  branding: string;
  terminationPolicy: string;
  rateLimit: string;
  geographicLimit: string;
  privacyBasis: string;
  legalOwner: string;
  realProviderApproved: boolean;
  approvedAt?: string | null;
  updatedAt: string;
}

const SUBJECT_TYPES = new Set<CommerceSubjectTypeV2>(["user", "wallet", "session", "organization"]);
const PRODUCT_TYPES = new Set<CommerceProductTypeV2>([
  "layer",
  "layer-bundle",
  "subscription",
  "content",
  "feature",
  "world"
]);
const STATUSES = new Set<EntitlementStatusV2>([
  "pending",
  "active",
  "grace",
  "expired",
  "revoked",
  "refunded"
]);
const GRANTS = new Set<EntitlementGrantV2>([
  "view",
  "query",
  "detail",
  "comment",
  "review",
  "export",
  "collaborate",
  "commercial-use"
]);
const SOURCE_PROVIDERS = new Set<EntitlementSourceProviderV2>([
  "mapos",
  "stripe",
  "crypto",
  "external",
  "admin",
  "promotion"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required.`);
  }
}

function dateTime(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be a date-time.`);
  }
}

export function assertEntitlementV2(value: unknown): asserts value is EntitlementV2 {
  if (!record(value)) throw new TypeError("Entitlement must be an object.");
  requiredText(value.schema, "schema");
  requiredText(value.schemaVersion, "schemaVersion");
  assertCompatibleSchema(
    { schema: value.schema, schemaVersion: value.schemaVersion },
    ENTITLEMENT_SCHEMA
  );
  requiredText(value.id, "id");
  if (!record(value.subject)) throw new TypeError("subject is required.");
  if (!SUBJECT_TYPES.has(value.subject.type as CommerceSubjectTypeV2)) {
    throw new TypeError("subject.type is not supported.");
  }
  requiredText(value.subject.id, "subject.id");
  if (!record(value.product)) throw new TypeError("product is required.");
  if (!PRODUCT_TYPES.has(value.product.type as CommerceProductTypeV2)) {
    throw new TypeError("product.type is not supported.");
  }
  requiredText(value.product.id, "product.id");
  if (value.product.providerId != null)
    requiredText(value.product.providerId, "product.providerId");
  if (!STATUSES.has(value.status as EntitlementStatusV2)) {
    throw new TypeError("status is not supported.");
  }
  if (!Array.isArray(value.grants) || value.grants.length === 0) {
    throw new TypeError("grants must not be empty.");
  }
  const uniqueGrants = new Set<unknown>();
  for (const grant of value.grants) {
    if (!GRANTS.has(grant as EntitlementGrantV2)) {
      throw new TypeError("grants contains an unsupported grant.");
    }
    if (uniqueGrants.has(grant)) throw new TypeError("grants must be unique.");
    uniqueGrants.add(grant);
  }
  if (value.startsAt != null) dateTime(value.startsAt, "startsAt");
  if (value.endsAt != null) dateTime(value.endsAt, "endsAt");
  if (
    typeof value.startsAt === "string" &&
    typeof value.endsAt === "string" &&
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)
  ) {
    throw new TypeError("endsAt must follow startsAt.");
  }
  if (value.source !== undefined) {
    if (!record(value.source)) throw new TypeError("source must be an object.");
    if (
      value.source.provider !== undefined &&
      !SOURCE_PROVIDERS.has(value.source.provider as EntitlementSourceProviderV2)
    ) {
      throw new TypeError("source.provider is not supported.");
    }
    for (const key of ["externalCustomerId", "externalTransactionId", "referralId"] as const) {
      if (value.source[key] != null) requiredText(value.source[key], `source.${key}`);
    }
  }
  if (value.metadata !== undefined && !record(value.metadata)) {
    throw new TypeError("metadata must be an object.");
  }
  dateTime(value.createdAt, "createdAt");
  dateTime(value.updatedAt, "updatedAt");
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    throw new TypeError("updatedAt must not precede createdAt.");
  }
}

/** Effective intervals are half-open: access is valid at startsAt and invalid at endsAt. */
export function isEntitlementEffective(
  entitlement: EntitlementV2,
  grant: EntitlementGrantV2,
  at: Date = new Date()
): boolean {
  if (entitlement.status !== "active" && entitlement.status !== "grace") return false;
  if (!entitlement.grants.includes(grant)) return false;
  const time = at.getTime();
  if (entitlement.startsAt && time < Date.parse(entitlement.startsAt)) return false;
  if (entitlement.endsAt && time >= Date.parse(entitlement.endsAt)) return false;
  return true;
}
