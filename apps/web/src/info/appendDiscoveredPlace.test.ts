import assert from "node:assert/strict";
import { it } from "node:test";
import { applyPlanCommand, assertPlanDocumentV2 } from "@mapos/layer-sdk";
import { appendDiscoveredPlace } from "./appendDiscoveredPlace";
it("collects actual places in order without invented endpoints and undo preserves later stops", () => {
  const first = appendDiscoveredPlace(null, { id: "a", name: "A", lng: 14, lat: 50 });
  assertPlanDocumentV2(first.plan);
  assert.equal(first.plan.stops.length, 1);
  assert.equal(first.plan.segments.length, 0);
  const second = appendDiscoveredPlace(first.plan, { id: "b", name: "B", lng: 15, lat: 51 });
  const third = appendDiscoveredPlace(second.plan, { id: "c", name: "C", lng: 16, lat: 52 });
  assert.deepEqual(
    third.plan.stops.map((stop) => stop.sourceFeatureId),
    ["a", "b", "c"]
  );
  const undone = applyPlanCommand(third.plan, {
    id: "undo",
    expectedRevision: third.plan.revision,
    command: { type: "remove-stop", stopId: first.stopId }
  }).plan;
  assert.deepEqual(
    undone.stops.map((stop) => stop.sourceFeatureId),
    ["b", "c"]
  );
  const remaining = applyPlanCommand(undone, {
    id: "undo2",
    expectedRevision: undone.revision,
    command: { type: "remove-stop", stopId: second.stopId }
  }).plan;
  assertPlanDocumentV2(remaining);
  assert.equal(remaining.stops[0]?.name, "C");
  assert.throws(() => assertPlanDocumentV2({ ...remaining, status: "planned" }));
});
