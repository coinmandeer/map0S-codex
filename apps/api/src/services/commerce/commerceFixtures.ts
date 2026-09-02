import type { CommerceCatalogRecord } from "./commerceRepository.js";

/** Clearly labelled fixture contract. It is not evidence for a real provider agreement. */
export function syntheticCommerceCatalog(
  now: Date = new Date("2026-09-01T00:00:00.000Z")
): CommerceCatalogRecord[] {
  const updatedAt = now.toISOString();
  const monthly: CommerceCatalogRecord = {
    contract: {
      id: "use-case:synthetic-camper-layer",
      status: "approved",
      product: {
        type: "layer",
        id: "synthetic-premium-camper",
        providerId: "mapos-synthetic-fixture"
      },
      rights: {
        display: true,
        cache: false,
        export: false,
        offline: false,
        aiTools: false,
        backgroundSync: false,
        retentionAfterTermination: false
      },
      authenticationMethod: "MapOS test session",
      billingUnit: "month",
      referralTerms: "No payout; synthetic fixture attribution only",
      revenueShareTerms: "No money or revenue share",
      supportOwner: "MapOS development fixture",
      refundOwner: "MapOS development fixture",
      attribution: "Synthetic MapOS fixture",
      branding: "Must be labelled synthetic",
      terminationPolicy: "Disable fixture and revoke future access immediately",
      rateLimit: "100 fixture reads per minute",
      geographicLimit: "Synthetic sample coverage only",
      privacyBasis: "Test data; no third-party personal data",
      legalOwner: "MapOS development fixture",
      realProviderApproved: false,
      approvedAt: updatedAt,
      updatedAt
    },
    product: {
      id: "synthetic-premium-camper",
      useCaseId: "use-case:synthetic-camper-layer",
      type: "layer",
      providerId: "mapos-synthetic-fixture",
      name: "Synthetic premium camper layer",
      description: "Offline contract fixture; not a real paid data source.",
      publicMetadata: {
        synthetic: true,
        sampleAvailable: false,
        coverage: "fixture-only",
        attribution: "Synthetic MapOS fixture"
      },
      status: "active",
      createdAt: updatedAt,
      updatedAt
    },
    offer: {
      id: "offer:synthetic-camper-month",
      productId: "synthetic-premium-camper",
      billingUnit: "month",
      amountMinor: 499,
      currency: "EUR",
      grants: ["view", "query", "detail"],
      periodCount: 1,
      status: "active",
      providerPriceId: null,
      createdAt: updatedAt,
      updatedAt
    }
  };
  const oneTime = structuredClone(monthly);
  oneTime.contract.id = "use-case:synthetic-camper-pass";
  oneTime.contract.product.id = "synthetic-premium-camper-pass";
  oneTime.contract.billingUnit = "one-time";
  oneTime.product.id = "synthetic-premium-camper-pass";
  oneTime.product.useCaseId = oneTime.contract.id;
  oneTime.product.name = "Synthetic premium camper day pass";
  oneTime.offer.id = "offer:synthetic-camper-once";
  oneTime.offer.productId = oneTime.product.id;
  oneTime.offer.billingUnit = "one-time";
  oneTime.offer.amountMinor = 1499;
  const tip = structuredClone(monthly);
  tip.contract.id = "use-case:synthetic-tip-mapos";
  tip.contract.product = { type: "content", id: "tip-recipient:project:mapos" };
  tip.contract.billingUnit = "tip";
  tip.contract.rights = {
    display: true,
    cache: false,
    export: false,
    offline: false,
    aiTools: false,
    backgroundSync: false,
    retentionAfterTermination: false
  };
  tip.product.id = tip.contract.product.id;
  tip.product.useCaseId = tip.contract.id;
  tip.product.type = "content";
  tip.product.providerId = null;
  tip.product.name = "Support the synthetic MapOS project";
  tip.product.description = "Offline tip-flow fixture; never transfers real money.";
  tip.product.publicMetadata = {
    synthetic: true,
    recipientType: "project",
    recipientId: "mapos",
    attribution: "Synthetic MapOS fixture"
  };
  tip.offer.id = "offer:tip:project:mapos";
  tip.offer.productId = tip.product.id;
  tip.offer.billingUnit = "tip";
  tip.offer.amountMinor = 0;
  tip.offer.grants = ["view"];
  return [monthly, oneTime, tip];
}
