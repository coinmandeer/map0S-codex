/** Application ceilings, NOT proof of unused provider credits. Allocation is operator-verified. */
export const PRODUCTS = {
  "mapy-credits": {
    provider: "mapy",
    sku: "project-credits",
    monthly: 225000,
    daily: null,
    operations: ["tile", "geocode", "route", "matrix", "elevation"]
  },
  // Capacity ceilings only. Actual access remains zero until an operator verifies an allocation.
  "ai-overview-tokens": {
    provider: "ollama",
    sku: "overview-token-envelope",
    monthly: 10000000,
    daily: null,
    operations: ["synthesis"]
  },
  "ai-overview-web": {
    provider: "ollama",
    sku: "overview-web-request",
    monthly: 10000,
    daily: null,
    operations: ["search", "fetch"]
  },
  "google-tiles": {
    provider: "google",
    sku: "2d-map-tiles",
    monthly: 80000,
    daily: null,
    operations: ["tile"]
  },
  "google-search": {
    provider: "google",
    sku: "text-search-pro",
    monthly: 1000,
    daily: null,
    operations: ["search"]
  },
  "google-details": {
    provider: "google",
    sku: "place-details-pro",
    monthly: 1000,
    daily: null,
    operations: ["detail"]
  },
  "google-details-extended": {
    provider: "google",
    sku: "place-details-enterprise",
    monthly: 500,
    daily: null,
    operations: ["extended-detail"]
  },
  "google-routes": {
    provider: "google",
    sku: "routes-essentials",
    monthly: 1000,
    daily: null,
    operations: ["route"]
  },
  "google-photos": { provider: "google", sku: "photos", monthly: 0, daily: null, operations: [] },
  "google-street-tiles": {
    provider: "google",
    sku: "street-view-tiles",
    monthly: 0,
    daily: null,
    operations: []
  },
  "foursquare-pro": {
    provider: "foursquare",
    sku: "places-pro",
    monthly: 450,
    daily: 15,
    operations: ["search", "detail"]
  },
  "foursquare-premium": {
    provider: "foursquare",
    sku: "places-premium",
    monthly: 0,
    daily: 0,
    operations: []
  }
} as const;
export type BudgetProduct = keyof typeof PRODUCTS;
export type BudgetCode =
  "budget-disabled" | "budget-exhausted" | "budget-unavailable" | "operation-not-allowed";
export class ProviderBudgetError extends Error {
  constructor(public readonly code: BudgetCode) {
    super(
      code === "budget-exhausted"
        ? "Bezplatný limit je vyčerpaný."
        : code === "budget-disabled"
          ? "Poskytovatel čeká na ověření bezplatného rozpočtu."
          : code === "operation-not-allowed"
            ? "Tato operace není povolená."
            : "Evidenci rozpočtu se nepodařilo ověřit."
    );
    this.name = "ProviderBudgetError";
  }
}
export function budgetPolicy(product: BudgetProduct, operation: string, units: number) {
  const policy = PRODUCTS[product];
  if (
    !policy ||
    !(policy.operations as readonly string[]).includes(operation) ||
    !Number.isSafeInteger(units) ||
    units < 1 ||
    units > policy.monthly
  ) {
    throw new ProviderBudgetError("operation-not-allowed");
  }
  return policy;
}
