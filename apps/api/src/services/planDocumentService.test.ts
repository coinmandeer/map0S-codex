import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import { PlanCommandError, applyPlanCommand } from "./planDocumentService.js";

function planWithStops(count = 5): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: `plan-${count}`,
      name: "Command test",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: count }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 13 + index / 10,
        lat: 49 + index / 10,
        dwellMinutes: 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

const now = () => "2026-09-01T09:00:00.000Z";

describe("PlanDocument domain commands", () => {
  it("invalidates exactly the two segments adjacent to a changed middle location", () => {
    const plan = planWithStops();
    const expected = [plan.segments[1]!.id, plan.segments[2]!.id].sort();
    const result = applyPlanCommand(
      plan,
      {
        id: "command-update-middle",
        expectedRevision: plan.revision,
        actorId: "user:test",
        command: {
          type: "update-stop",
          stopId: "stop-2",
          patch: { location: { type: "Point", coordinates: [14.5, 50.5] } }
        }
      },
      { now }
    );

    assert.deepEqual(result.revision.affectedSegmentIds, expected);
    assert.deepEqual(
      result.plan.segments
        .filter((segment) => segment.status === "stale")
        .map((segment) => segment.id),
      expected
    );
    assert.equal(result.plan.revision, plan.revision + 1);
    assert.equal(result.revision.baseRevision, plan.revision);
    assert.equal(result.undoDocument.stops[2]?.location.coordinates[0], 13.2);
    assert.equal(plan.stops[2]?.location.coordinates[0], 13.2, "input document stays immutable");
  });

  it("does not invalidate route geometry for a name-only edit", () => {
    const plan = planWithStops();
    const result = applyPlanCommand(
      plan,
      {
        id: "rename",
        expectedRevision: 1,
        command: { type: "update-stop", stopId: "stop-2", patch: { name: "Nový název" } }
      },
      { now }
    );
    assert.deepEqual(result.revision.affectedSegmentIds, []);
    assert.equal(result.plan.stops[2]?.name, "Nový název");
  });

  it("reconciles adjacency locally for insert, remove and move commands", () => {
    const original = planWithStops(4);
    const added = applyPlanCommand(
      original,
      {
        id: "add",
        expectedRevision: 1,
        command: {
          type: "add-stop",
          index: 2,
          stop: {
            id: "inserted",
            name: "Inserted",
            location: { type: "Point", coordinates: [13.15, 49.15] },
            dwellMinutes: 0
          }
        }
      },
      { now }
    );
    assert.equal(added.plan.segments.length, added.plan.stops.length - 1);
    assert.deepEqual(
      added.plan.segments.map((segment) => [segment.fromStopId, segment.toStopId]),
      [
        ["stop-0", "stop-1"],
        ["stop-1", "inserted"],
        ["inserted", "stop-2"],
        ["stop-2", "stop-3"]
      ]
    );

    const removed = applyPlanCommand(
      added.plan,
      {
        id: "remove",
        expectedRevision: 2,
        command: { type: "remove-stop", stopId: "inserted" }
      },
      { now }
    );
    assert.deepEqual(
      removed.plan.stops.map((stop) => stop.order),
      [0, 1, 2, 3]
    );

    const moved = applyPlanCommand(
      removed.plan,
      {
        id: "move",
        expectedRevision: 3,
        command: { type: "move-stop", stopId: "stop-3", toIndex: 1 }
      },
      { now }
    );
    assert.deepEqual(
      moved.plan.stops.map((stop) => stop.id),
      ["stop-0", "stop-3", "stop-1", "stop-2"]
    );
    assert.equal(moved.plan.segments.length, 3);
  });

  it("invalidates every segment when route policy changes", () => {
    const plan = planWithStops(6);
    const result = applyPlanCommand(
      plan,
      {
        id: "policy",
        expectedRevision: 1,
        command: {
          type: "replace-route-policy",
          routePolicy: { profile: "bike", preference: "adventure", avoid: ["unpaved"] }
        }
      },
      { now }
    );
    assert.equal(result.revision.affectedSegmentIds.length, 5);
    assert.ok(result.plan.segments.every((segment) => segment.status === "stale"));
  });

  it("applies a batch atomically with one revision increment", () => {
    const plan = planWithStops();
    const result = applyPlanCommand(
      plan,
      {
        id: "batch",
        expectedRevision: 1,
        command: {
          type: "batch",
          commands: [
            { type: "update-stop", stopId: "stop-1", patch: { dwellMinutes: 30 } },
            { type: "update-stop", stopId: "stop-3", patch: { notes: "Poznámka" } }
          ]
        }
      },
      { now }
    );
    assert.equal(result.plan.revision, 2);
    assert.equal(result.plan.stops[1]?.dwellMinutes, 30);
    assert.equal(result.plan.stops[3]?.notes, "Poznámka");
  });

  it("guards optimistic revisions and invalid commands", () => {
    const plan = planWithStops();
    assert.throws(
      () =>
        applyPlanCommand(plan, {
          id: "stale",
          expectedRevision: 0,
          command: { type: "remove-stop", stopId: "stop-2" }
        }),
      (error: unknown) => error instanceof PlanCommandError && error.code === "REVISION_CONFLICT"
    );
    assert.throws(
      () =>
        applyPlanCommand(planWithStops(2), {
          id: "too-few",
          expectedRevision: 1,
          command: { type: "remove-stop", stopId: "stop-1" }
        }),
      /at least two stops/
    );
  });

  it("keeps middle-stop invalidation local even in a 250-stop plan", () => {
    const plan = planWithStops(250);
    const result = applyPlanCommand(
      plan,
      {
        id: "large-plan-edit",
        expectedRevision: 1,
        command: {
          type: "update-stop",
          stopId: "stop-125",
          patch: { location: { type: "Point", coordinates: [15, 50] } }
        }
      },
      { now }
    );
    assert.equal(result.plan.stops.length, 250);
    assert.equal(result.plan.segments.length, 249);
    assert.equal(result.revision.affectedSegmentIds.length, 2);
  });
});
