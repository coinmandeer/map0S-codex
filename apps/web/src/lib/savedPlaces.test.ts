import assert from "node:assert/strict";
import { test } from "node:test";
import type { GeoFeature, SavedPlaceV2 } from "@mapos/layer-sdk";
import {
  createSavedPlaceFromFeature,
  loadAllSavedPlaces,
  savedPlaceToFeature
} from "./savedPlaces";

function savedPlace(id: string): SavedPlaceV2 {
  return {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id,
    ownerUserId: "user-1",
    target: { type: "embedded-snapshot" },
    snapshot: {
      title: `Místo ${id}`,
      position: [14.4, 50.1],
      category: "viewpoint",
      sourceRefs: [{ source: "osm", sourceRef: "node/1" }],
      capturedAt: "2026-09-01T08:00:00.000Z"
    },
    category: "viewpoint",
    note: "Výhled",
    tags: ["výlet"],
    collectionId: null,
    sortOrder: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z"
  };
}

test("saved places become an owner-private map layer without losing the snapshot", () => {
  const feature = savedPlaceToFeature(savedPlace("saved-1"));
  assert.deepEqual(feature.geometry.coordinates, [14.4, 50.1]);
  assert.equal(feature.properties.layerId, "my-saved-places");
  assert.equal(feature.properties.name, "Místo saved-1");
  assert.equal(feature.properties.ownership, "owner-private");
  assert.equal(feature.properties.sourceRefs, "osm:node/1");
});

test("saved-place pagination is bounded and stops a repeated cursor", async () => {
  const previousFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    const page = urls.length;
    return new Response(
      JSON.stringify({
        savedPlaces: [savedPlace(`saved-${page}`)],
        nextCursor: page === 1 ? "next" : "next",
        limit: 100
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const places = await loadAllSavedPlaces();
    assert.deepEqual(
      places.map((place) => place.id),
      ["saved-1", "saved-2"]
    );
    assert.equal(urls.length, 2);
    assert.match(urls[0]!, /^\/api\/v2\/me\/saved-places\?/);
    assert.match(urls[1]!, /cursor=next/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("saving a user pin uses the narrow v2 snapshot contract", async () => {
  const previousFetch = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ savedPlace: savedPlace("saved-1") }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };
  const feature: GeoFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [14.4, 50.1] },
    properties: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Vyhlídka",
      description: "Krátký popis",
      category: "viewpoint",
      layerId: "user-layers",
      sourceRefs: "osm:node/1"
    }
  };
  try {
    assert.equal(await createSavedPlaceFromFeature(feature, "user-layers"), "ok");
    const requestBody = body as Record<string, unknown> | null;
    assert.deepEqual(requestBody?.target, {
      type: "user-pin",
      userPinId: "11111111-1111-4111-8111-111111111111"
    });
    assert.deepEqual(
      (requestBody?.snapshot as { position: [number, number] }).position,
      [14.4, 50.1]
    );
    assert.equal((requestBody?.snapshot as { title: string }).title, "Vyhlídka");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
