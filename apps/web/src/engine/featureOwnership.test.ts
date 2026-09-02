import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeatureCollection, GeoFeature } from "@mapos/layer-sdk";
import { applyFeatureOwnership, ownedUserPinRefs, userPinRef } from "./featureOwnership";

function feature(id: string, layerId: string, extra: Record<string, unknown> = {}): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [14, 50] },
    properties: { id, name: id, layerId, ...extra }
  };
}

function collection(features: GeoFeature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

describe("cross-layer feature ownership", () => {
  it("recognises the same user pin in native and fused representations", () => {
    assert.equal(userPinRef(feature("pin-1", "user-layers")), "pin-1");
    assert.equal(
      userPinRef(feature("osm:1", "osm-poi", { sourceRefs: "osm:1|user:pin-1" })),
      "pin-1"
    );
    assert.equal(userPinRef(feature("user:pin-1", "osm-poi")), "pin-1");
  });

  it("lets the active user layer own an overlapping community pin", () => {
    const mine = collection([feature("pin-1", "user-layers")]);
    const fused = collection([
      feature("user:pin-1", "osm-poi", { sourceRefs: "user:pin-1" }),
      feature("user:pin-2", "osm-poi", { sourceRefs: "user:pin-2" }),
      feature("osm:castle", "osm-poi", { sourceRefs: "osm:castle" })
    ]);

    const visible = applyFeatureOwnership("osm-poi", fused, ownedUserPinRefs(mine));
    assert.deepEqual(
      visible.features.map((f) => f.properties.id),
      ["user:pin-2", "osm:castle"]
    );
  });

  it("keeps the fused copy when the personal layer is off", () => {
    const fused = collection([feature("user:pin-1", "osm-poi")]);
    assert.equal(applyFeatureOwnership("osm-poi", fused, new Set()), fused);
  });

  it("never filters the owning user layer itself", () => {
    const mine = collection([feature("pin-1", "user-layers")]);
    assert.equal(applyFeatureOwnership("user-layers", mine, new Set(["pin-1"])), mine);
  });
});
