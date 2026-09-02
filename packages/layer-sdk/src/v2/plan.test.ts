import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { TripPlan } from "../types.js";
import { planV1ToV2, planV2ToV1 } from "../compat/planV1Adapter.js";
import {
  PLAN_DOCUMENT_V2_SCHEMA,
  assertPlanDocumentV2,
  canonicalPlanRoutingPolicy,
  planRoutePolicyHash
} from "./index.js";

const legacyPlan: TripPlan = {
  id: "plan-legacy",
  name: "Praha – Plzeň",
  departureAt: "2026-09-01T08:00:00.000Z",
  variant: "nohwy",
  stops: [
    { id: "prague", name: "Praha", lng: 14.42, lat: 50.08, dwellMinutes: 0 },
    { id: "plzen", name: "Plzeň", lng: 13.38, lat: 49.75, dwellMinutes: 60 }
  ],
  vehicle: { profile: "camper", heightM: 2.8, widthM: 2.1, weightT: 3.5 },
  visibility: "private",
  createdAt: "2026-08-31T20:00:00.000Z",
  updatedAt: "2026-09-01T07:00:00.000Z"
};

describe("PlanDocument v2 contract", () => {
  it("adapts v1 into a schema-valid adjacent-segment document", () => {
    const plan = planV1ToV2(legacyPlan, { now: "2026-09-01T09:00:00.000Z" });
    assertPlanDocumentV2(plan);
    assert.equal(plan.schema, "mapos.plan");
    assert.equal(plan.schemaVersion, "2.0.0");
    assert.equal(plan.segments.length, 1);
    assert.deepEqual(
      [plan.segments[0]?.fromStopId, plan.segments[0]?.toStopId],
      ["prague", "plzen"]
    );

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(PLAN_DOCUMENT_V2_SCHEMA);
    assert.equal(validate(plan), true, JSON.stringify(validate.errors));
  });

  it("does not encode the legacy 60-stop limit into the document", () => {
    const stops = Array.from({ length: 250 }, (_, index) => ({
      id: `stop-${index}`,
      name: `Stop ${index}`,
      lng: 10 + index / 1_000,
      lat: 45 + index / 1_000,
      dwellMinutes: 0
    }));
    const plan = planV1ToV2({ ...legacyPlan, stops });
    assert.equal(plan.stops.length, 250);
    assert.equal(plan.segments.length, 249);
    assert.doesNotThrow(() => assertPlanDocumentV2(plan));
  });

  it("enforces exact adjacency and selected-alternative integrity", () => {
    const plan = planV1ToV2(legacyPlan);
    const brokenAdjacency = structuredClone(plan);
    brokenAdjacency.segments[0]!.toStopId = "missing";
    assert.throws(() => assertPlanDocumentV2(brokenAdjacency), /adjacent stops/);

    const brokenSelection = structuredClone(plan);
    brokenSelection.segments[0]!.status = "ready";
    brokenSelection.segments[0]!.selectedAlternativeId = "missing";
    assert.throws(() => assertPlanDocumentV2(brokenSelection), /selectedAlternativeId/);
  });

  it("hashes semantically equal policy input identically", () => {
    const first = {
      profile: "car" as const,
      preference: "fast" as const,
      avoid: ["tolls" as const, "ferries" as const]
    };
    const second = {
      profile: "car" as const,
      preference: "fast" as const,
      avoid: ["ferries" as const, "tolls" as const]
    };
    assert.equal(canonicalPlanRoutingPolicy(first), canonicalPlanRoutingPolicy(second));
    assert.equal(planRoutePolicyHash(first), planRoutePolicyHash(second));
  });

  it("projects back to v1 without losing ordered stops", () => {
    const v2 = planV1ToV2(legacyPlan);
    assert.deepEqual(planV2ToV1(v2), legacyPlan);
  });
});
