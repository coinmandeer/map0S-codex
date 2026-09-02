import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2 } from "../compat/planV1Adapter.js";
import { applyPlanCommand, restorePlanSnapshot } from "./planCommands.js";

function plan() {
  return planV1ToV2(
    {
      id: "command-plan",
      name: "Původní plán",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
        { id: "b", name: "B", lng: 15, lat: 49, dwellMinutes: 0 },
        { id: "c", name: "C", lng: 16, lat: 48, dwellMinutes: 0 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

const now = () => "2026-09-01T09:00:00.000Z";

describe("shared PlanDocument command engine", () => {
  it("updates plan metadata without invalidating route segments", () => {
    const input = plan();
    const result = applyPlanCommand(
      input,
      {
        id: "rename",
        expectedRevision: 1,
        command: { type: "update-plan", patch: { name: "Nový název" } }
      },
      { now }
    );
    assert.equal(result.plan.name, "Nový název");
    assert.deepEqual(result.revision.affectedSegmentIds, []);
  });

  it("invalidates every edge when vehicle routing constraints change", () => {
    const input = plan();
    const result = applyPlanCommand(
      input,
      {
        id: "vehicle",
        expectedRevision: 1,
        command: {
          type: "replace-vehicle",
          vehicle: { profile: "camper", heightM: 3.1, weightT: 3.5 }
        }
      },
      { now }
    );
    assert.equal(result.plan.routePolicy.profile, "camper");
    assert.equal(result.revision.affectedSegmentIds.length, 2);
    assert.ok(result.plan.segments.every((segment) => segment.status === "stale"));
  });

  it("selects one segment alternative without mutating any neighbouring segment", () => {
    const input = plan();
    input.segments = input.segments.map((segment) => ({
      ...segment,
      status: "ready",
      alternatives: [
        {
          id: `${segment.id}-recommended`,
          providerId: "fixture",
          profile: "car",
          preference: "fast",
          geometry: {
            type: "LineString",
            coordinates: [
              input.stops[segment.order]!.location.coordinates,
              input.stops[segment.order + 1]!.location.coordinates
            ]
          },
          distanceM: 1_000,
          durationS: 100,
          warnings: []
        },
        {
          id: `${segment.id}-scenic`,
          providerId: "fixture",
          profile: "car",
          preference: "fast",
          geometry: {
            type: "LineString",
            coordinates: [
              input.stops[segment.order]!.location.coordinates,
              [14.5 + segment.order, 49.5 - segment.order],
              input.stops[segment.order + 1]!.location.coordinates
            ]
          },
          distanceM: 1_250,
          durationS: 130,
          warnings: ["scenic"]
        }
      ],
      selectedAlternativeId: `${segment.id}-recommended`
    }));
    const untouchedNeighbour = structuredClone(input.segments[1]);

    const result = applyPlanCommand(
      input,
      {
        id: "choose-scenic",
        expectedRevision: 1,
        command: {
          type: "select-segment-alternative",
          segmentId: input.segments[0]!.id,
          alternativeId: `${input.segments[0]!.id}-scenic`
        }
      },
      { now }
    );

    assert.equal(result.plan.segments[0]?.selectedAlternativeId, `${input.segments[0]!.id}-scenic`);
    assert.deepEqual(result.plan.segments[1], untouchedNeighbour);
    assert.deepEqual(result.revision.affectedSegmentIds, []);
  });

  it("restores an undo snapshot as a new monotonic revision", () => {
    const input = plan();
    const changed = applyPlanCommand(
      input,
      {
        id: "move",
        expectedRevision: 1,
        command: { type: "move-stop", stopId: "c", toIndex: 1 }
      },
      { now }
    );
    const restored = restorePlanSnapshot(changed.plan, changed.undoDocument, { now });
    assert.deepEqual(
      restored.stops.map((stop) => stop.id),
      ["a", "b", "c"]
    );
    assert.equal(restored.revision, 3);
  });

  it("rejects runtime metadata escalation hidden inside an update-plan patch", () => {
    const input = plan();
    const malicious = {
      id: "escalate",
      expectedRevision: 1,
      command: {
        type: "update-plan",
        patch: {
          name: "Still plausible",
          ownerId: "attacker",
          id: "stolen-plan",
          revision: 999
        }
      }
    };
    assert.throws(
      () => applyPlanCommand(input, malicious as never, { now }),
      /command\.patch\.ownerId is not allowed/
    );
    assert.equal(input.ownerId, undefined);
    assert.equal(input.id, "command-plan");
    assert.equal(input.revision, 1);
  });

  it("rejects unknown envelope fields and recursively bounds batch commands", () => {
    const input = plan();
    assert.throws(
      () =>
        applyPlanCommand(
          input,
          {
            id: "unknown-envelope",
            expectedRevision: 1,
            command: { type: "update-plan", patch: { name: "Safe" } },
            elevated: true
          } as never,
          { now }
        ),
      /envelope\.elevated is not allowed/
    );

    let nested: unknown = { type: "update-plan", patch: { name: "Deep" } };
    for (let depth = 0; depth < 10; depth += 1) nested = { type: "batch", commands: [nested] };
    assert.throws(
      () =>
        applyPlanCommand(
          input,
          { id: "deep-batch", expectedRevision: 1, command: nested } as never,
          { now }
        ),
      /nesting is too deep/
    );

    const wideTree = {
      type: "batch",
      commands: ["left", "right"].map((side) => ({
        type: "batch",
        commands: Array.from({ length: 50 }, (_, index) => ({
          type: "update-plan",
          patch: { name: `${side}-${index}` }
        }))
      }))
    };
    assert.throws(
      () =>
        applyPlanCommand(
          input,
          { id: "wide-batch", expectedRevision: 1, command: wideTree } as never,
          { now }
        ),
      /at most 100 commands/
    );
  });
});
