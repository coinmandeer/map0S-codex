import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoFeature } from "@mapos/layer-sdk";
import { encodeRefs, placeRefsFromFeature } from "./placeDetail";

function feature(layerId: string, properties: Record<string, unknown> = {}): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [14.2, 50.1] },
    properties: {
      id: "place-42",
      name: "Místo",
      layerId,
      ...properties
    }
  };
}

describe("place detail identity", () => {
  it("keeps every fused provider ref in a stable encoded identity", () => {
    const refs = placeRefsFromFeature(
      feature("osm-poi", { sourceRefs: "osm:node/42|wikidata:Q42" }),
      "osm-poi"
    );
    assert.equal(refs.refs.osm, "node/42");
    assert.equal(refs.refs.wikidata, "Q42");
    assert.equal(encodeRefs(refs.refs), "osm:node/42|wikidata:Q42");
  });

  it("adapts a known provider-owned legacy layer without inventing a ref", () => {
    const refs = placeRefsFromFeature(feature("park4night"), "park4night");
    assert.equal(refs.refs.park4night, "place-42");
  });
});
