import assert from "node:assert/strict";
import test from "node:test";
import {
  createFoursquarePlaces,
  normalizeFoursquare,
  FOURSQUARE_PRO_FIELDS,
  FOURSQUARE_API_VERSION
} from "./foursquarePlaces.js";
import { ProviderBudgetError } from "./providerBudget/policy.js";

test("Foursquare is explicit, Pro-only, versioned and budgeted; search is at most three candidates", async () => {
  const calls: Array<{
    url: string;
    options: NonNullable<
      Parameters<NonNullable<Parameters<typeof createFoursquarePlaces>[0]>["fetch"]>[1]
    >;
  }> = [];
  let reservations = 0;
  const service = createFoursquarePlaces({
    configuration: () => ({ enabled: true, key: "synthetic-test-token", account: "test" }),
    reserve: async (input) => {
      assert.equal(input.product, "foursquare-pro");
      reservations++;
      return "test-reservation";
    },
    fetch: async <T>(
      url: string,
      options: NonNullable<
        Parameters<NonNullable<Parameters<typeof createFoursquarePlaces>[0]>["fetch"]>[1]
      >
    ): Promise<T> => {
      calls.push({ url, options });
      await options.budget!.reserve(new AbortController().signal);
      return {
        results: Array.from({ length: 5 }, (_, i) => ({
          fsq_place_id: `test-${i}`,
          name: "Cafe",
          rating: 9,
          photos: ["not-allowed"],
          website: "javascript:bad"
        }))
      } as T;
    }
  });
  assert.equal(calls.length, 0);
  const result = await service.search({ name: "Cafe", lng: 1.25, lat: 41.12 });
  const url = new URL(calls[0]!.url),
    options = calls[0]!.options;
  assert.equal(url.origin, "https://places-api.foursquare.com");
  assert.equal(url.pathname, "/places/search");
  assert.equal(url.searchParams.get("radius"), "200");
  assert.equal(url.searchParams.get("limit"), "3");
  assert.equal(url.searchParams.get("fields"), FOURSQUARE_PRO_FIELDS.join(","));
  assert.equal(options.headers!["X-Places-Api-Version"], FOURSQUARE_API_VERSION);
  assert.equal(options.retries, 0);
  assert.equal(options.ttlMs, 0);
  assert.equal(result.length, 3);
  assert.equal(reservations, 1);
  assert.equal(result[0]!.rating, null);
  assert.deepEqual(result[0]!.photos, []);
  assert.equal(result[0]!.website, null);
});

test("Foursquare remains closed without explicit activation, even with a key", async () => {
  let calls = 0;
  const service = createFoursquarePlaces({
    configuration: () => ({ enabled: false, key: "synthetic", account: "test" }),
    reserve: async () => {
      calls++;
      return "x";
    },
    fetch: async <T>() => {
      calls++;
      return {} as T;
    }
  });
  await assert.rejects(
    service.detail("known-legacy-id"),
    (e) => e instanceof ProviderBudgetError && e.code === "budget-disabled"
  );
  assert.equal(calls, 0);
});

test("normalization rejects missing identity and drops premium/unrequested provider data", () => {
  assert.equal(normalizeFoursquare({ name: "no identity" }), null);
  const value = normalizeFoursquare({
    fsq_place_id: "old-id",
    name: "Cafe",
    latitude: 0,
    longitude: 0,
    photos: ["x"],
    rating: 8,
    hours: { display: "daily" },
    raw: "never-export"
  });
  assert.equal(value!.latitude, 0);
  assert.equal(value!.rating, null);
  assert.equal(value!.hours, null);
  assert.equal("raw" in value!, false);
});
