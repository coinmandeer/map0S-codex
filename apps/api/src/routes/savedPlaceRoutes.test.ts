import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import Fastify from "fastify";
import { memoryDb } from "../db/memory.js";
import { registerClientSafeErrorHandler } from "../utils/clientError.js";
import { MemorySavedPlaceRepository } from "../services/savedPlaceMemoryRepository.js";
import { SavedPlaceService } from "../services/savedPlaceService.js";
import { registerSavedPlaceRoutes } from "./savedPlaceRoutes.js";

const FIXED_TIME = "2026-09-01T10:00:00.000Z";

function snapshot(title = "Karlštejn") {
  return {
    title,
    position: [14.188, 49.939] as [number, number],
    category: "castle",
    description: "Hrad",
    sourceRefs: [{ source: "osm", sourceRef: "relation/123" }],
    attribution: "© OpenStreetMap přispěvatelé",
    capturedAt: FIXED_TIME
  };
}

function resetSavedState() {
  memoryDb.savedPlaces.length = 0;
  memoryDb.savedPlaceCollections.length = 0;
}

beforeEach(resetSavedState);

async function testApp() {
  const app = Fastify({ logger: false });
  registerClientSafeErrorHandler(app);
  const service = new SavedPlaceService(
    new MemorySavedPlaceRepository(),
    () => new Date(FIXED_TIME)
  );
  registerSavedPlaceRoutes(app, {
    service,
    resolveUserId(request) {
      const value = request.headers["x-user-id"];
      return typeof value === "string" && value ? value : null;
    }
  });
  return { app, service };
}

test("shared API enforces auth and exact bounded target/snapshot schemas", async (t) => {
  const { app } = await testApp();
  t.after(() => app.close());

  const anonymous = await app.inject({ method: "GET", url: "/v2/me/saved-places" });
  assert.equal(anonymous.statusCode, 401);

  const invalidTarget = await app.inject({
    method: "POST",
    url: "/v2/me/saved-places",
    headers: { "x-user-id": "owner-a" },
    payload: {
      target: {
        type: "canonical-place",
        canonicalPlaceId: "canonical-1",
        userPinId: "pin-1"
      },
      snapshot: snapshot()
    }
  });
  assert.equal(invalidTarget.statusCode, 400);

  const unboundedSnapshot = await app.inject({
    method: "POST",
    url: "/v2/me/saved-places",
    headers: { "x-user-id": "owner-a" },
    payload: {
      target: { type: "embedded-snapshot" },
      snapshot: { ...snapshot(), providerPayload: { arbitrary: true } }
    }
  });
  assert.equal(unboundedSnapshot.statusCode, 400);

  const viewportQuery = await app.inject({
    method: "GET",
    url: "/v2/me/saved-places?bbox=13,49,15,51",
    headers: { "x-user-id": "owner-a" }
  });
  assert.equal(viewportQuery.statusCode, 400, "saved places must not acquire viewport semantics");
});

test("collection and saved-place CRUD round-trip metadata while enforcing owner ACL", async (t) => {
  const { app } = await testApp();
  t.after(() => app.close());
  const owner = { "x-user-id": "owner-a" };

  const collectionResponse = await app.inject({
    method: "POST",
    url: "/v2/me/saved-place-collections",
    headers: owner,
    payload: {
      name: "Víkend",
      icon: "🏰",
      color: "#AABBCC",
      visibility: "private"
    }
  });
  assert.equal(collectionResponse.statusCode, 201);
  const collection = collectionResponse.json().collection as { id: string; color: string };
  assert.equal(collection.color, "#aabbcc");

  const foreignCollectionRead = await app.inject({
    method: "GET",
    url: `/v2/me/saved-place-collections/${collection.id}`,
    headers: { "x-user-id": "owner-b" }
  });
  assert.equal(foreignCollectionRead.statusCode, 404);

  const collectionPatch = await app.inject({
    method: "PATCH",
    url: `/v2/me/saved-place-collections/${collection.id}`,
    headers: owner,
    payload: { name: "Hrady na víkend", visibility: "unlisted" }
  });
  assert.equal(collectionPatch.statusCode, 200);
  assert.equal(collectionPatch.json().collection.name, "Hrady na víkend");
  assert.equal(collectionPatch.json().collection.visibility, "unlisted");

  const duplicateCollection = await app.inject({
    method: "POST",
    url: "/v2/me/saved-place-collections",
    headers: owner,
    payload: { name: "Hrady na víkend" }
  });
  assert.equal(duplicateCollection.statusCode, 409);

  const collections = await app.inject({
    method: "GET",
    url: "/v2/me/saved-place-collections",
    headers: owner
  });
  assert.equal(collections.statusCode, 200);
  assert.deepEqual(
    collections.json().collections.map((item: { id: string }) => item.id),
    [collection.id]
  );

  const createResponse = await app.inject({
    method: "POST",
    url: "/v2/me/saved-places",
    headers: owner,
    payload: {
      target: { type: "external-feature", externalFeatureRef: "osm:relation/123" },
      snapshot: snapshot(),
      category: "castle",
      note: "Vrátit se mimo sezónu",
      tags: ["výlet", "historie"],
      collectionId: collection.id,
      sortOrder: 7
    }
  });
  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.headers["cache-control"], "private, no-store");
  const created = createResponse.json().savedPlace as {
    id: string;
    ownerUserId: string;
    target: { type: string; externalFeatureRef: string };
    snapshot: ReturnType<typeof snapshot>;
    note: string;
    tags: string[];
    collectionId: string;
    sortOrder: number;
  };
  assert.equal(created.ownerUserId, "owner-a");
  assert.deepEqual(created.target, {
    type: "external-feature",
    externalFeatureRef: "osm:relation/123"
  });
  assert.deepEqual(created.snapshot, snapshot());
  assert.deepEqual(created.tags, ["výlet", "historie"]);

  const ownRead = await app.inject({
    method: "GET",
    url: `/v2/me/saved-places/${created.id}`,
    headers: owner
  });
  assert.equal(ownRead.statusCode, 200);
  assert.deepEqual(ownRead.json().savedPlace.snapshot, snapshot());

  const foreignRead = await app.inject({
    method: "GET",
    url: `/v2/me/saved-places/${created.id}`,
    headers: { "x-user-id": "owner-b" }
  });
  assert.equal(foreignRead.statusCode, 404);

  const patchResponse = await app.inject({
    method: "PATCH",
    url: `/v2/me/saved-places/${created.id}`,
    headers: owner,
    payload: { note: null, tags: ["hrad"], collectionId: null, sortOrder: -2 }
  });
  assert.equal(patchResponse.statusCode, 200);
  assert.deepEqual(patchResponse.json().savedPlace.tags, ["hrad"]);
  assert.equal(patchResponse.json().savedPlace.note, null);
  assert.equal(patchResponse.json().savedPlace.collectionId, null);
  assert.equal(patchResponse.json().savedPlace.sortOrder, -2);

  const immutableTarget = await app.inject({
    method: "PATCH",
    url: `/v2/me/saved-places/${created.id}`,
    headers: owner,
    payload: { target: { type: "embedded-snapshot" } }
  });
  assert.equal(immutableTarget.statusCode, 400);

  const deleteResponse = await app.inject({
    method: "DELETE",
    url: `/v2/me/saved-places/${created.id}`,
    headers: owner
  });
  assert.equal(deleteResponse.statusCode, 204);
  const missing = await app.inject({
    method: "GET",
    url: `/v2/me/saved-places/${created.id}`,
    headers: owner
  });
  assert.equal(missing.statusCode, 404);
});

test("cursor, search, category and collection filters are deterministic and clamp limit to 100", async () => {
  const { service } = await testApp();
  const owner = "owner-a";
  const collection = await service.createCollection(owner, { name: "Hrady" });

  for (let index = 0; index < 105; index += 1) {
    await service.create(owner, {
      target: { type: "embedded-snapshot" },
      snapshot: snapshot(index === 104 ? "Tajný cíl" : `Místo ${index}`),
      category: index % 2 ? "cafe" : "castle",
      tags: index === 104 ? ["unikát"] : [],
      collectionId: index < 3 ? collection.id : null,
      sortOrder: index
    });
  }

  const first = await service.list(owner, { limit: 10_000 });
  assert.equal(first.limit, 100);
  assert.equal(first.savedPlaces.length, 100);
  assert.ok(first.nextCursor);
  const second = await service.list(owner, { limit: 100, cursor: first.nextCursor! });
  assert.equal(second.savedPlaces.length, 5);
  assert.equal(second.nextCursor, null);

  const category = await service.list(owner, { category: "cafe", limit: 100 });
  assert.equal(category.savedPlaces.length, 52);
  assert.ok(category.savedPlaces.every((place) => place.category === "cafe"));

  const collected = await service.list(owner, { collection: collection.id, limit: 100 });
  assert.equal(collected.savedPlaces.length, 3);
  assert.ok(collected.savedPlaces.every((place) => place.collectionId === collection.id));

  const searched = await service.list(owner, { q: "unikát", limit: 100 });
  assert.equal(searched.savedPlaces.length, 1);
  assert.equal(searched.savedPlaces[0]?.snapshot.title, "Tajný cíl");
});

test("a collection cannot cross owners and deletion detaches rather than deletes its places", async (t) => {
  const { app, service } = await testApp();
  t.after(() => app.close());
  const foreign = await service.createCollection("owner-b", { name: "Cizí" });

  await assert.rejects(
    service.create("owner-a", {
      target: { type: "embedded-snapshot" },
      snapshot: snapshot(),
      collectionId: foreign.id
    }),
    /Kolekce nebyla nalezena/
  );

  const own = await service.createCollection("owner-a", { name: "Vlastní" });
  const place = await service.create("owner-a", {
    target: { type: "embedded-snapshot" },
    snapshot: snapshot(),
    collectionId: own.id
  });

  const foreignDelete = await app.inject({
    method: "DELETE",
    url: `/v2/me/saved-place-collections/${own.id}`,
    headers: { "x-user-id": "owner-b" }
  });
  assert.equal(foreignDelete.statusCode, 404);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/v2/me/saved-place-collections/${own.id}`,
    headers: { "x-user-id": "owner-a" }
  });
  assert.equal(deleted.statusCode, 204);
  assert.equal((await service.get("owner-a", place.id)).collectionId, null);
  await assert.rejects(service.getCollection("owner-a", own.id), /Kolekce nebyla nalezena/);
});
