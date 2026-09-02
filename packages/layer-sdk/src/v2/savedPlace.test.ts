import assert from "node:assert/strict";
import test from "node:test";
import type { SavedPlaceV2 } from "./savedPlace.js";
import { normalizeSavedPlaceLimit } from "./savedPlace.js";

test("saved-place v2 target is discriminated and the list limit never exceeds 100", () => {
  const saved = {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id: "save-1",
    ownerUserId: "user-1",
    target: { type: "external-feature", externalFeatureRef: "osm:node/1" },
    snapshot: {
      title: "Vyhlídka",
      position: [14.4, 50.1],
      category: "viewpoint",
      sourceRefs: [{ source: "osm", sourceRef: "node/1" }],
      capturedAt: "2026-09-01T10:00:00.000Z"
    },
    category: "viewpoint",
    note: "Východ slunce",
    tags: ["výlet"],
    collectionId: null,
    sortOrder: 10,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z"
  } satisfies SavedPlaceV2;

  assert.equal(saved.target.type, "external-feature");
  assert.equal(normalizeSavedPlaceLimit(10_000), 100);
  assert.equal(normalizeSavedPlaceLimit("0"), 1);
  assert.equal(normalizeSavedPlaceLimit("25.9"), 25);
  assert.equal(normalizeSavedPlaceLimit("bad"), 20);
});
