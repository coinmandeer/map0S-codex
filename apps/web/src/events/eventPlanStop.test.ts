import assert from "node:assert/strict";
import test from "node:test";
import type { EventDocumentV2, PlanDocumentV2 } from "@mapos/layer-sdk";
import {
  addEventToPlan,
  createEventPlanDocument,
  createEventPlanStopDraft,
  eventToPlanStop
} from "./eventPlanStop";

const event: EventDocumentV2 = {
  schema: "mapos.event",
  schemaVersion: "2.0.0",
  id: "event:demo",
  revision: 1,
  title: "Demo concert",
  categories: ["music"],
  status: "rescheduled",
  schedule: {
    startsAt: "2026-10-01T18:00:00.000Z",
    endsAt: "2026-10-01T21:00:00.000Z",
    timezone: "Europe/Prague"
  },
  venue: {
    name: "Arena",
    location: { type: "Point", coordinates: [14.42, 50.08] }
  },
  ticketUrl: "https://tickets.example.invalid/demo",
  sources: [
    {
      providerId: "demo",
      sourceId: "1",
      retrievedAt: "2026-09-01T08:00:00.000Z",
      attribution: "Demo"
    }
  ]
};

const plan: PlanDocumentV2 = {
  schema: "mapos.plan",
  schemaVersion: "2.0.0",
  id: "plan-1",
  revision: 1,
  name: "Trip",
  status: "draft",
  visibility: "private",
  routePolicy: { profile: "car", preference: "fast" },
  stops: [
    {
      id: "start",
      order: 0,
      name: "Start",
      location: { type: "Point", coordinates: [14.4, 50] },
      dwellMinutes: 0
    },
    {
      id: "finish",
      order: 1,
      name: "Finish",
      location: { type: "Point", coordinates: [14.5, 50.2] },
      dwellMinutes: 0
    }
  ],
  segments: [
    {
      id: "segment:start:finish",
      order: 0,
      fromStopId: "start",
      toStopId: "finish",
      policyHash: "legacy",
      status: "pending",
      alternatives: []
    }
  ],
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z"
};

test("event becomes a dated, locked PlanDocument stop with provenance", () => {
  const stop = eventToPlanStop(event, "event-stop-1");
  assert.equal(stop.arrivalAt, event.schedule.startsAt);
  assert.equal(stop.departureAt, event.schedule.endsAt);
  assert.equal(stop.dwellMinutes, 180);
  assert.equal(stop.constraints?.eventStatus, "rescheduled");
  assert.deepEqual(stop.constraints?.sourceIds, ["demo:1"]);
});

test("event is inserted before the final stop and is not duplicated", () => {
  const added = addEventToPlan(plan, event, {
    stopId: "event-stop-1",
    commandId: "command-1",
    now: () => "2026-09-01T09:00:00.000Z"
  });
  assert.equal(added.added, true);
  assert.deepEqual(
    added.plan.stops.map((stop) => stop.id),
    ["start", "event-stop-1", "finish"]
  );
  assert.equal(added.plan.revision, 2);
  assert.equal(addEventToPlan(added.plan, event).added, false);
});

test("safe draft preserves the same dated stop when no active plan exists", () => {
  const draft = createEventPlanStopDraft(event, "2026-09-01T09:00:00.000Z");
  assert.equal(draft.schema, "mapos.event-plan-stop-draft");
  assert.equal(draft.stop.arrivalAt, event.schedule.startsAt);
  assert.equal(draft.eventId, event.id);
  const document = createEventPlanDocument(event, {
    id: "plan-from-event",
    now: "2026-09-01T09:00:00.000Z"
  });
  assert.equal(document.stops[0]?.sourceFeatureId, event.id);
  assert.equal(document.departureAt, event.schedule.startsAt);
  assert.equal(document.segments.length, 0);
});
