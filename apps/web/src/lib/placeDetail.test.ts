import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import type { GeoFeature } from "@mapos/layer-sdk";
import { encodeRefs, placeRefsFromFeature, fetchPlaceDetailStrict } from "./placeDetail";

test("detail cache reuses the identity/revision and never retains no-store responses", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({
        id: "cached",
        name: "Test",
        lng: 14,
        lat: 50,
        category: "poi",
        sources: []
      }),
      { headers: { "cache-control": calls > 2 ? "no-store" : "private, max-age=300" } }
    );
  });
  const refs = placeRefsFromFeature(
    feature("osm-poi", { id: "cache-test", revision: "1" }),
    "osm-poi"
  );
  const first = await fetchPlaceDetailStrict(refs);
  first.name = "mutated";
  assert.equal((await fetchPlaceDetailStrict(refs)).name, "Test");
  assert.equal(calls, 1);
  await fetchPlaceDetailStrict({ ...refs, revision: "2" });
  assert.equal(calls, 2);
  await fetchPlaceDetailStrict({ ...refs, revision: "3" });
  await fetchPlaceDetailStrict({ ...refs, revision: "3" });
  assert.equal(calls, 4);
});

test("detail cache respects a provider TTL shorter than the local five-minute cap", async (t) => {
  let now = 1_000_000;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ id: "short-ttl", name: "Test", sources: [] }), {
      headers: { "cache-control": "private, max-age=1" }
    });
  });
  const refs = placeRefsFromFeature(feature("osm-poi", { id: "short-ttl" }), "osm-poi");
  await fetchPlaceDetailStrict(refs);
  now += 999;
  await fetchPlaceDetailStrict(refs);
  assert.equal(calls, 1);
  now += 2;
  await fetchPlaceDetailStrict(refs);
  assert.equal(calls, 2);
});

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
