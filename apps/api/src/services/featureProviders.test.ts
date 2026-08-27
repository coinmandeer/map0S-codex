import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlaceSourceId } from "@mapos/layer-sdk";
import { PLACE_SOURCES } from "@mapos/layer-sdk";
import { FEATURE_PROVIDERS, featureProvider, layerListing } from "./featureProviders.js";
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

  it("lists every provider, so the listing cannot drift from what is servable", () => {
    assert.deepEqual(
      layerListing().map((l) => l.id),
      FEATURE_PROVIDERS.map((p) => p.id)
    );
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
