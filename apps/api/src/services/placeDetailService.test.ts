import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSourceRefs, parseSourceRefs, sourceRef } from "@mapos/layer-sdk";
import { placesToFeatureCollection } from "./placesPresentation.js";
import { __testing, getPlaceDetail } from "./placeDetailService.js";

const now = new Date().toISOString();

test("source refs survive the trip through GeoJSON properties", () => {
  const fc = placesToFeatureCollection({
    places: [
      {
        id: "osm:240",
        name: "Hrad Okoř",
        lng: 14.2,
        lat: 50.1,
        category: "castle",
        wikidata: "Q42",
        sources: [
          { source: "osm", sourceRef: "240", confidence: 0.75, refreshedAt: now },
          { source: "wikidata", sourceRef: "Q42", confidence: 0.7, refreshedAt: now }
        ]
      }
    ],
    meta: { sources: [], merged: 0 }
  });

  const refs = fc.features[0]!.properties.sourceRefs;
  assert.equal(sourceRef(refs, "osm"), "240");
  assert.equal(sourceRef(refs, "wikidata"), "Q42");
});

test("refs with a slash or colon in them round-trip intact", () => {
  const encoded = encodeSourceRefs([
    { source: "osm", sourceRef: "node/240", confidence: 1, refreshedAt: now },
    { source: "mapy", sourceRef: "base:1234", confidence: 1, refreshedAt: now }
  ]);
  assert.deepEqual(parseSourceRefs(encoded), [
    { source: "osm", ref: "node/240" },
    { source: "mapy", ref: "base:1234" }
  ]);
});

test("unknown sources are dropped rather than trusted", () => {
  assert.deepEqual(parseSourceRefs("bogus:1|osm:2"), [{ source: "osm", ref: "2" }]);
  assert.deepEqual(parseSourceRefs(undefined), []);
  assert.deepEqual(parseSourceRefs("osm:"), []);
});

/** Every resolver is offline here — these tests are about how the detail is assembled, not
 *  about whether Overpass answered. Enrichment is disabled explicitly so a configured Foursquare
 *  key cannot turn a unit test into a network call. */
const offline = { resolvers: [], enrichment: false };

test("a place no resolver owns still opens from the pin's own coordinates", async () => {
  const place = await getPlaceDetail(
    {
      id: "inaturalist:987",
      lng: 14.4,
      lat: 50.08,
      name: "Pozorování",
      category: "observation"
    },
    offline
  );
  assert.ok(place);
  assert.equal(place.name, "Pozorování");
  assert.equal(place.lng, 14.4);
});

test("without coordinates or a resolvable ref there is nothing to show", async () => {
  assert.equal(await getPlaceDetail({ id: "inaturalist:987" }, offline), null);
});

test("a wikidata ref becomes the place's QID even when the pin did not carry one", async () => {
  const place = await getPlaceDetail(
    { id: "osm:240", sourceRefs: "osm:240|wikidata:Q42", lng: 14.2, lat: 50.1, name: "Hrad" },
    offline
  );
  assert.equal(place?.wikidata, "Q42");
  assert.deepEqual(
    place?.sources.map((s) => s.source),
    ["osm", "wikidata"]
  );
});

test("the owning source's record wins over the pin's hints", async () => {
  const place = await getPlaceDetail(
    { id: "osm:240", lng: 0, lat: 0, name: "Zastaralý název" },
    {
      enrichment: false,
      resolvers: [
        {
          source: "osm",
          resolve: async () => ({ name: "Hrad Okoř", lng: 14.2, lat: 50.1, category: "castle" })
        }
      ]
    }
  );
  assert.equal(place?.name, "Hrad Okoř");
  assert.equal(place?.lat, 50.1);
});

test("a resolver that throws degrades to the hints instead of failing the request", async () => {
  const place = await getPlaceDetail(
    { id: "osm:240", lng: 14.2, lat: 50.1, name: "Hrad" },
    {
      enrichment: false,
      resolvers: [
        {
          source: "osm",
          resolve: async () => {
            throw new Error("overpass down");
          }
        }
      ]
    }
  );
  assert.equal(place?.name, "Hrad");
});

test("a private user pin resolves only for its owning session", async () => {
  const privatePin = {
    name: "Soukromé místo",
    lng: 14.2,
    lat: 50.1,
    tags: ["private"],
    ownerUserId: "owner-id",
    layerIsPublic: 0
  };
  const load = async () => privatePin;

  assert.equal(await __testing.resolveUserPinForViewer("pin-id", null, load), null);
  assert.equal(await __testing.resolveUserPinForViewer("pin-id", "other-id", load), null);
  assert.equal(
    (await __testing.resolveUserPinForViewer("pin-id", "owner-id", load))?.name,
    "Soukromé místo"
  );
});

test("a pin in a public layer resolves without a session", async () => {
  const load = async () => ({
    name: "Veřejné místo",
    lng: 14.2,
    lat: 50.1,
    tags: [],
    ownerUserId: "owner-id",
    layerIsPublic: 1
  });

  const place = await __testing.resolveUserPinForViewer("pin-id", null, load);
  assert.equal(place?.name, "Veřejné místo");
  assert.equal(place?.category, "user-pin");
});

test("lazy detail retains the description resolved from its owning source", async () => {
  const place = await getPlaceDetail(
    { id: "osm:node:123", sourceRefs: "osm:node:123" },
    {
      enrichment: false,
      resolvers: [
        {
          source: "osm",
          resolve: async () => ({
            name: "Landmark",
            lng: 14,
            lat: 50,
            category: "castle",
            description: "Full description loaded on opening the pin."
          })
        }
      ]
    }
  );
  assert.equal(place?.description, "Full description loaded on opening the pin.");
});

test("single-source summaries omit lazy contact data, mixed sources retain unresolved enrichment", () => {
  const source = {
    source: "mapy" as const,
    sourceRef: "base:1",
    confidence: 0.8,
    refreshedAt: now
  };
  const place = {
    id: "mapy:base:1",
    name: "Test",
    lng: 14,
    lat: 50,
    category: "poi",
    address: "A".repeat(200),
    phone: "123",
    website: "https://example.com",
    openingHours: "Mo-Fr 09:00-17:00",
    sources: [source]
  };
  const response = { places: [place], meta: { sources: [], merged: 0 } };
  const summary = placesToFeatureCollection(response);
  assert.equal(summary.features[0]!.properties.address, undefined);
  assert.equal(summary.features[0]!.properties.phone, undefined);
  assert.equal(sourceRef(summary.features[0]!.properties.sourceRefs, "mapy"), "base:1");
  const mixed = placesToFeatureCollection({
    ...response,
    places: [{ ...place, sources: [source, { ...source, source: "osm", sourceRef: "node/1" }] }]
  });
  assert.equal(mixed.features[0]!.properties.address, place.address);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < Buffer.byteLength(JSON.stringify(mixed)));
});
