import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { memoryDb } from "../db/memory.js";
import { MemoryDataRightsRepository } from "./dataRightsMemoryRepository.js";
import { DataRightsService } from "./dataRightsService.js";
import { MemoryIdentityRepository } from "./identity/identityService.js";

const USER_ID = "data-rights-user";

function forbiddenKeys(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => forbiddenKeys(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = path ? `${path}.${key}` : key;
    return ["password", "passwordHash", "sessionId", "idempotencyKey", "providerOrderId"].includes(
      key
    )
      ? [next]
      : forbiddenKeys(child, next);
  });
}

function seedOwner(identityRepository: MemoryIdentityRepository): void {
  memoryDb.users.push({
    id: USER_ID,
    email: "portable@example.test",
    password: "must-never-export",
    displayName: "Portable owner",
    isGuest: false,
    xpTotal: 12
  });
  memoryDb.sessions.set("data-rights-session-a", {
    userId: USER_ID,
    expiresAt: new Date("2027-01-01T00:00:00.000Z")
  });
  memoryDb.sessions.set("data-rights-session-b", {
    userId: USER_ID,
    expiresAt: new Date("2027-01-01T00:00:00.000Z")
  });
  memoryDb.userLayers.push({
    id: "data-rights-layer",
    userId: USER_ID,
    name: "Portable layer",
    color: "#102030",
    slug: "data-rights-layer",
    isPublic: 0
  });
  memoryDb.pins.push({
    id: "data-rights-pin",
    layerId: "data-rights-layer",
    name: "Portable pin",
    lng: 13.3,
    lat: 49.7
  });
  const now = new Date("2026-09-01T08:00:00.000Z");
  memoryDb.savedPlaceCollections.push({
    id: "data-rights-collection",
    userId: USER_ID,
    name: "Portable collection",
    icon: null,
    color: null,
    visibility: "private",
    createdAt: now,
    updatedAt: now
  });
  memoryDb.savedPlaces.push({
    id: "data-rights-place",
    userId: USER_ID,
    target: { type: "embedded-snapshot" },
    snapshot: {
      title: "Portable place",
      position: [13.3, 49.7],
      category: null,
      description: null,
      sourceRefs: [],
      attribution: null,
      capturedAt: now.toISOString()
    },
    category: "place",
    note: "private note",
    tags: [],
    collectionId: "data-rights-collection",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now
  });
  memoryDb.planDocuments.push({
    userId: USER_ID,
    plan: planV1ToV2(
      {
        id: "data-rights-plan",
        name: "Portable plan",
        departureAt: now.toISOString(),
        variant: "fast",
        stops: [
          { id: "a", name: "A", lng: 13.3, lat: 49.7, dwellMinutes: 0 },
          { id: "b", name: "B", lng: 13.4, lat: 49.8, dwellMinutes: 0 }
        ],
        vehicle: { profile: "car" },
        visibility: "private"
      },
      { ownerId: USER_ID, now: now.toISOString() }
    )
  });
  memoryDb.comments.push({
    id: "data-rights-comment",
    userId: USER_ID,
    targetType: "place",
    targetId: "data-rights-place",
    body: "Portable comment",
    createdAt: now.toISOString()
  });
  memoryDb.questCompletions.set(USER_ID, new Set(["quest-1"]));
  memoryDb.collectedOrbs.set(USER_ID, new Set(["orb-1"]));
  memoryDb.gameProfiles.set(`${USER_ID}:trail-signals`, { score: 9 });
  identityRepository.identities.set("data-rights-identity", {
    id: "data-rights-identity",
    userId: USER_ID,
    type: "wallet",
    provider: "siwe",
    subject: "0x1111111111111111111111111111111111111111",
    displayLabel: null,
    simulated: false,
    verifiedAt: now.toISOString(),
    revokedAt: null,
    createdAt: now.toISOString()
  });
}

describe("account data rights", () => {
  it("exports and erases places, plans, layers, comments, identities, game data and all sessions", async () => {
    const identityRepository = new MemoryIdentityRepository();
    seedOwner(identityRepository);
    const service = new DataRightsService(
      new MemoryDataRightsRepository(identityRepository),
      () => new Date("2026-09-01T12:00:00.000Z")
    );

    const exported = await service.exportAccount(USER_ID);
    assert.equal(exported.places.saved[0]?.id, "data-rights-place");
    assert.equal(exported.plans[0]?.id, "data-rights-plan");
    assert.equal(exported.layers[0]?.id, "data-rights-layer");
    assert.equal((exported.layers[0]?.pins as Array<{ id: string }>)[0]?.id, "data-rights-pin");
    assert.equal(exported.social.comments[0]?.id, "data-rights-comment");
    assert.equal(exported.identities[0]?.id, "data-rights-identity");
    assert.deepEqual(forbiddenKeys(exported), []);

    const deleted = await service.deleteAccount(USER_ID);
    assert.deepEqual(deleted, { status: "deleted", retained: [] });
    assert.equal(
      memoryDb.users.some((user) => user.id === USER_ID),
      false
    );
    assert.equal(
      [...memoryDb.sessions.values()].some((session) => session.userId === USER_ID),
      false
    );
    assert.equal(
      memoryDb.userLayers.some((layer) => layer.userId === USER_ID),
      false
    );
    assert.equal(
      memoryDb.pins.some((pin) => pin.id === "data-rights-pin"),
      false
    );
    assert.equal(
      memoryDb.savedPlaces.some((place) => place.userId === USER_ID),
      false
    );
    assert.equal(
      memoryDb.planDocuments.some((plan) => plan.userId === USER_ID),
      false
    );
    assert.equal(
      memoryDb.comments.some((comment) => comment.userId === USER_ID),
      false
    );
    assert.equal(identityRepository.identities.size, 0);
    assert.equal(memoryDb.questCompletions.has(USER_ID), false);
    assert.equal(memoryDb.collectedOrbs.has(USER_ID), false);
    assert.equal(memoryDb.gameProfiles.has(`${USER_ID}:trail-signals`), false);
  });
});
