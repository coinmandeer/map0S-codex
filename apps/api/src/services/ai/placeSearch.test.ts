import assert from "node:assert/strict";
import test from "node:test";
import type { Place, PlacesResponse } from "@mapos/layer-sdk";
import {
  aiCategoryLabel,
  createFusedPlaceSearchSource,
  createMemoryPlaceSearchSource,
  inferAiCategories,
  nearestPoiSourceFromSearch,
  resolveOsmCategories
} from "./placeSearch.js";
import type { AiToolExecutionContext } from "./toolRegistry.js";

const context: AiToolExecutionContext = {
  actor: {
    authenticated: true,
    userId: "user-1",
    permissions: new Set(["poi:read"]),
    entitlementIds: new Set()
  },
  projection: {
    allowedLayerIds: new Set(["osm-poi"]),
    allowedPlanIds: new Set(),
    allowedFeatureFieldsByLayer: new Map(),
    allowedDataClasses: new Set(["public"]),
    allowPreciseLocation: false
  },
  signal: new AbortController().signal
};

function place(overrides: Partial<Place> & Pick<Place, "id" | "name" | "lng" | "lat">): Place {
  return {
    category: "camp_site",
    sources: [
      { source: "osm", sourceRef: `node/${overrides.id}`, refreshedAt: "2026-09-01T00:00:00.000Z" }
    ],
    ...overrides
  } as Place;
}

test("a question names its categories without asking a model", () => {
  assert.deepEqual(inferAiCategories("kde najdu klidný kemp u vody?"), ["stay.camp_site"]);
  assert.deepEqual(inferAiCategories("hrady a zámky poblíž"), ["culture.castle", "culture.palace"]);
  // "barva" must not become a bar: keywords match whole words only.
  assert.deepEqual(inferAiCategories("jakou barvu má ta vrstva?"), []);
  assert.deepEqual(resolveOsmCategories(["stay.camp_site", "camp_site", "nonsense"]), [
    "camp_site"
  ]);
  assert.equal(aiCategoryLabel("stay.camp_site"), "Kempy");
});

test("search returns places sorted by distance, with one citation per source", async () => {
  const requests: unknown[] = [];
  const source = createFusedPlaceSearchSource(async (query): Promise<PlacesResponse> => {
    requests.push(query);
    return {
      places: [
        place({ id: "far", name: "Kemp Daleko", lng: 13.5, lat: 49.75 }),
        place({ id: "near", name: "Kemp Blízko", lng: 13.379, lat: 49.749 }),
        // No OSM provenance: nothing to cite, so it must not reach the model.
        {
          ...place({ id: "orphan", name: "Kemp Bez Zdroje", lng: 13.38, lat: 49.749 }),
          sources: []
        }
      ],
      meta: []
    } as unknown as PlacesResponse;
  });

  const result = await source.search(
    {
      categories: ["stay.camp_site"],
      near: { longitude: 13.3775, latitude: 49.7475 },
      radiusMeters: 20_000,
      limit: 10
    },
    context
  );

  assert.deepEqual(
    result.places.map((entry) => entry.title),
    ["Kemp Blízko", "Kemp Daleko"]
  );
  assert.equal(result.places[0]!.category, "stay.camp_site");
  assert.ok(result.places[0]!.distanceMeters! < result.places[1]!.distanceMeters!);
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.every((citation) => citation.label.includes("OpenStreetMap")));
  // A centre and a radius are enough; the bbox is derived rather than demanded of the model.
  assert.equal(requests.length, 1);
});

test("a search without a resolvable category asks nothing upstream", async () => {
  let calls = 0;
  const source = createFusedPlaceSearchSource(async () => {
    calls += 1;
    return { places: [], meta: [] } as unknown as PlacesResponse;
  });
  const result = await source.search({ categories: ["nonsense"], limit: 5 }, context);
  assert.deepEqual(result.places, []);
  assert.equal(calls, 0);
});

test("find_nearest_poi and search cannot disagree, because it is the same source", async () => {
  const search = createMemoryPlaceSearchSource(() => [
    { osmId: "node/1", category: "bar", name: "Bar U Mostu", lng: 13.378, lat: 49.748 },
    { osmId: "node/2", category: "camp_site", name: "Kemp", lng: 13.379, lat: 49.749 }
  ]);
  const nearest = nearestPoiSourceFromSearch(search);
  const records = await nearest.query(
    {
      longitude: 13.3775,
      latitude: 49.7475,
      radiusMeters: 5_000,
      layerIds: ["osm-poi"],
      category: "food.bar"
    },
    context
  );
  assert.deepEqual(
    records.map((record) => record.title),
    ["Bar U Mostu"]
  );
  assert.equal(records[0]!.category, "food.bar");
  assert.ok(records[0]!.source.sourceId.startsWith("osm-fixture:"));
});

test("opaque AI identity preserves the real OSM detail reference", async () => {
  const source = createFusedPlaceSearchSource(
    async () =>
      ({
        places: [
          place({
            id: "fusion-123",
            name: "Castle",
            lng: 1.2,
            lat: 41.1,
            sources: [
              {
                source: "osm",
                confidence: 1,
                sourceRef: "way:12345",
                refreshedAt: "2026-09-08T00:00:00Z"
              }
            ]
          })
        ],
        meta: []
      }) as unknown as PlacesResponse
  );
  const result = await source.search(
    { categories: ["camp_site"], bbox: [1, 40, 2, 42], limit: 3 },
    context
  );
  assert.match(result.places[0]!.id, /^poi:/);
  assert.equal(result.places[0]!.sourceFeatureId, "osm:way:12345");
});
