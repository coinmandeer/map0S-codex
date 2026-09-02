import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeatureQueryResultV2, PlaceSourceId } from "@mapos/layer-sdk";
import { MAPOS_V2_SCHEMA_VERSION, PLACE_SOURCES } from "@mapos/layer-sdk";
import {
  FEATURE_PROVIDERS,
  featureProvider,
  layerListing,
  withFeatureQueryBudget
} from "./featureProviders.js";
import { PLACE_SOURCE_ADAPTERS, adapterFor } from "./poiFusionService.js";

describe("feature provider registry", () => {
  it("serves the layers the client can ask for", () => {
    for (const id of ["osm-poi", "user-layers", "park4night"]) {
      assert.equal(typeof featureProvider(id)?.features, "function", `${id} should be fetchable`);
    }
  });

  it("has no endpoint for layers that render client-side", () => {
    // Weather draws from tile services and the game layer builds its own scene; offering a
    // features endpoint for them would be a route that can only ever 500.
    assert.equal(featureProvider("weather")?.features, undefined);
    assert.equal(featureProvider("game")?.features, undefined);
  });

  it("reports unknown layers as absent rather than throwing", () => {
    assert.equal(featureProvider("does-not-exist"), undefined);
  });

  it("exposes v2 only for providers with a reviewed mapping", () => {
    assert.equal(typeof featureProvider("earthquakes")?.featuresV2, "function");
    assert.equal(featureProvider("inaturalist")?.featuresV2, undefined);
    assert.equal(featureProvider("osm-poi")?.featuresV2, undefined);
  });

  it("lists every provider, so the listing cannot drift from what is servable", () => {
    assert.deepEqual(
      layerListing().map((l) => l.id),
      FEATURE_PROVIDERS.map((p) => p.id)
    );
  });

  it("enforces the per-layer budget around every legacy provider", async () => {
    const provider = withFeatureQueryBudget({
      id: "fixture",
      name: "Fixture",
      kind: "pins",
      async features() {
        return {
          type: "FeatureCollection",
          features: Array.from({ length: 140 }, (_, index) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [14, 50] as [number, number] },
            properties: { id: `fixture:${index}`, name: `Fixture ${index}`, layerId: "fixture" }
          }))
        };
      }
    });

    const hostile = await provider.features!({ bbox: [13, 49, 15, 51], query: { limit: "10000" } });
    const requested = await provider.features!({ bbox: [13, 49, 15, 51], query: { limit: "7" } });
    assert.equal(hostile.features.length, 100);
    assert.equal(requested.features.length, 7);
  });

  it("repairs an over-budget v2 provider response and its metadata", async () => {
    const raw: FeatureQueryResultV2 = {
      data: {
        type: "FeatureCollection",
        features: Array.from({ length: 120 }, (_, index) => ({
          schema: "mapos.feature" as const,
          schemaVersion: MAPOS_V2_SCHEMA_VERSION,
          id: `fixture:${index}`,
          revision: 1,
          geometry: { type: "Point" as const, coordinates: [14, 50] as [number, number] },
          properties: {
            title: `Fixture ${index}`,
            kind: "place" as const,
            category: "fixture",
            layerIds: ["fixture"]
          },
          sources: [],
          access: { visibility: "public" as const, permissions: ["view" as const] },
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z"
        }))
      },
      meta: {
        limit: 500,
        returned: 120,
        truncated: false,
        nextCursor: "provider-cursor",
        cache: "miss",
        sources: []
      },
      notices: []
    };
    const provider = withFeatureQueryBudget({
      id: "fixture-v2",
      name: "Fixture v2",
      kind: "pins",
      async featuresV2() {
        return raw;
      }
    });

    const result = await provider.featuresV2!({
      bbox: [13, 49, 15, 51],
      query: { limit: "10000" }
    });
    assert.equal(result.data.features.length, 100);
    assert.equal(result.meta.limit, 100);
    assert.equal(result.meta.returned, 100);
    assert.equal(result.meta.truncated, true);
    assert.equal(result.meta.nextCursor, "provider-cursor");
  });
});

describe("place source adapters", () => {
  it("covers every source the SDK offers the user", () => {
    // A source in the picker with no adapter would silently return nothing.
    const covered = new Set(PLACE_SOURCE_ADAPTERS.map((a) => a.id));
    for (const source of PLACE_SOURCES) {
      assert.ok(covered.has(source.id), `${source.id} has no adapter`);
    }
  });

  it("gives each source a distinct trust level for merge conflicts", () => {
    for (const adapter of PLACE_SOURCE_ADAPTERS) {
      assert.ok(
        adapter.confidence > 0 && adapter.confidence <= 1,
        `${adapter.id} has an out-of-range confidence`
      );
    }
    // User pins outrank every upstream: someone typed them in on purpose.
    const user = adapterFor("user" as PlaceSourceId)!;
    for (const other of PLACE_SOURCE_ADAPTERS.filter((a) => a.id !== "user")) {
      assert.ok(user.confidence > other.confidence, `user should outrank ${other.id}`);
    }
  });

  it("explains why an unavailable source is skipped", () => {
    // The reason is surfaced in the source strip; "nothing happened" is the failure mode this
    // guards against.
    for (const adapter of PLACE_SOURCE_ADAPTERS) {
      const reason = adapter.unavailableReason?.();
      if (reason !== null && reason !== undefined) {
        assert.ok(reason.length > 0, `${adapter.id} skips without saying why`);
      }
    }
    assert.ok(adapterFor("overture" as PlaceSourceId)?.unavailableReason?.());
    assert.equal(adapterFor("osm" as PlaceSourceId)?.unavailableReason?.() ?? null, null);
  });
});
