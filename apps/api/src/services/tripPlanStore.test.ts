import assert from "node:assert/strict";
import test from "node:test";
import { planV1ToV2, type TripPlan } from "@mapos/layer-sdk";
import { storedPayloadToPlanDocument } from "./tripPlanStore.js";

const legacy: TripPlan = {
  id: "legacy-local-id",
  name: "Legacy",
  departureAt: "2026-09-01T08:00:00.000Z",
  variant: "fast",
  stops: [
    { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
    { id: "b", name: "B", lng: 15, lat: 49, dwellMinutes: 0 }
  ],
  vehicle: { profile: "car" },
  visibility: "private"
};

const envelope = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000002",
  name: "Stored name",
  visibility: "unlisted" as const,
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z"
};

test("legacy JSONB rows are promoted to owner-scoped PlanDocument v2", () => {
  const document = storedPayloadToPlanDocument(legacy, envelope);
  assert.equal(document.schema, "mapos.plan");
  assert.equal(document.id, envelope.id);
  assert.equal(document.ownerId, envelope.ownerId);
  assert.equal(document.name, envelope.name);
  assert.equal(document.visibility, "unlisted");
  assert.equal(document.segments.length, 1);
  assert.equal(document.metadata?.["dev.mapos.persisted"], true);
});

test("native v2 rows retain revisions and segment results while DB ACL fields win", () => {
  const input = planV1ToV2(legacy, { now: envelope.createdAt });
  input.revision = 7;
  input.ownerId = "hostile-owner";
  input.name = "Payload name";
  const document = storedPayloadToPlanDocument(input, envelope);
  assert.equal(document.revision, 7);
  assert.equal(document.ownerId, envelope.ownerId);
  assert.equal(document.name, envelope.name);
  assert.equal(document.createdAt, envelope.createdAt);
  assert.equal(document.updatedAt, envelope.updatedAt);
});
