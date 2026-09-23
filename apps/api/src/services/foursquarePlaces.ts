import { fetchJson } from "../utils/upstream.js";
import { providerBudgets } from "./providerBudget/repository.js";
import { ProviderBudgetError } from "./providerBudget/policy.js";

// https://docs.foursquare.com/fsq-developers-places/reference/response-fields (verified 2026-09-07).
// Deliberately no rating, hours, photos, tips, stats, price or description (Premium).
export const FOURSQUARE_PRO_FIELDS = [
  "fsq_place_id",
  "name",
  "categories",
  "location",
  "latitude",
  "longitude",
  "website",
  "tel",
  "date_closed"
] as const;
export const FOURSQUARE_API_VERSION = "2025-06-17";
export interface FoursquareDetail {
  fsqId: string;
  name: string | null;
  categories: string[];
  address: string | null;
  website: string | null;
  tel: string | null;
  dateClosed: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string;
  attribution: string;
  // Existing saved/detail clients stay readable. These are never requested from Pro API.
  rating: null;
  ratingCount: null;
  price: null;
  hours: null;
  photos: [];
  tips: [];
}
function text(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
function web(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function normalizeFoursquare(value: unknown): FoursquareDetail | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.fsq_place_id !== "string" || !/^[\w-]{1,100}$/.test(p.fsq_place_id)) return null;
  const location = (p.location && typeof p.location === "object" ? p.location : {}) as Record<
    string,
    unknown
  >;
  return {
    fsqId: p.fsq_place_id,
    name: text(p.name),
    categories: (Array.isArray(p.categories) ? p.categories : [])
      .slice(0, 12)
      .flatMap((c) => (text(c?.name) ? [text(c.name)!] : [])),
    address:
      [location.address, location.locality, location.region, location.postcode, location.country]
        .map((v) => text(v))
        .filter(Boolean)
        .join(", ") || null,
    latitude:
      typeof p.latitude === "number" && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
        ? p.latitude
        : null,
    longitude:
      typeof p.longitude === "number" &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.longitude) <= 180
        ? p.longitude
        : null,
    website: web(p.website),
    tel: text(p.tel, 80),
    dateClosed: text(p.date_closed, 40),
    url: `https://foursquare.com/v/${encodeURIComponent(p.fsq_place_id)}`,
    attribution: "Foursquare",
    rating: null,
    ratingCount: null,
    price: null,
    hours: null,
    photos: [],
    tips: []
  };
}
export function createFoursquarePlaces(
  dependencies = {
    fetch: fetchJson,
    reserve: providerBudgets.reserve,
    configuration: () => ({
      enabled: process.env.FSQ_PLACES_ENABLED === "1",
      key: process.env.FSQ_API_KEY?.trim(),
      account: process.env.FSQ_BUDGET_ACCOUNT?.trim()
    })
  }
) {
  async function request(
    path: string,
    params: URLSearchParams,
    operation: "search" | "detail",
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const cfg = dependencies.configuration();
    if (!cfg.enabled || !cfg.key || !cfg.account) throw new ProviderBudgetError("budget-disabled");
    params.set("fields", FOURSQUARE_PRO_FIELDS.join(","));
    return dependencies.fetch<unknown>(
      `https://places-api.foursquare.com/places/${path}?${params}`,
      {
        providerId: "foursquare-pro",
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          "X-Places-Api-Version": FOURSQUARE_API_VERSION
        },
        signal,
        ttlMs: 0,
        retries: 0,
        timeoutMs: 10000,
        maxResponseBytes: 256 * 1024,
        budget: {
          scope: `foursquare-pro:${cfg.account}:${operation}`,
          reserve: (s) =>
            dependencies.reserve({ product: "foursquare-pro", account: cfg.account!, operation }, s)
        }
      }
    );
  }
  return {
    async detail(id: string, signal?: AbortSignal) {
      if (!/^[\w-]{1,100}$/.test(id)) return null;
      return normalizeFoursquare(
        await request(encodeURIComponent(id), new URLSearchParams(), "detail", signal)
      );
    },
    async search(input: { name: string; lng: number; lat: number }, signal?: AbortSignal) {
      if (
        !input.name.trim() ||
        input.name.length > 120 ||
        !Number.isFinite(input.lat) ||
        !Number.isFinite(input.lng) ||
        Math.abs(input.lat) > 90 ||
        Math.abs(input.lng) > 180
      )
        throw new Error("Invalid place search");
      const raw = (await request(
        "search",
        new URLSearchParams({
          query: input.name.trim(),
          ll: `${input.lat},${input.lng}`,
          radius: "200",
          limit: "3"
        }),
        "search",
        signal
      )) as { results?: unknown[] };
      return (Array.isArray(raw?.results) ? raw.results : []).slice(0, 3).flatMap((v) => {
        const p = normalizeFoursquare(v);
        return p ? [p] : [];
      });
    }
  };
}
export const foursquarePlaces = createFoursquarePlaces();
export const getFoursquareDetail = foursquarePlaces.detail;
