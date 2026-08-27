import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSourceRefs, parseSourceRefs, sourceRef } from "@mapos/layer-sdk";
import { placesToFeatureCollection } from "./placesPresentation.js";
import { getPlaceDetail } from "./placeDetailService.js";

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
 *  about whether Overpass answered. */
const offline = { resolvers: [] };

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
