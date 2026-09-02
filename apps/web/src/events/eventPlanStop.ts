import {
  applyPlanCommand,
  type EventDocumentV2,
  type JsonValue,
  type PlanDocumentV2,
  type PlanStopV2
} from "@mapos/layer-sdk";

export const EVENT_PLAN_DRAFT_STORAGE_KEY = "mapos.event-plan-stop-draft.v2";

export interface EventPlanStopDraft {
  schema: "mapos.event-plan-stop-draft";
  schemaVersion: "2.0.0";
  eventId: string;
  stop: Omit<PlanStopV2, "order">;
  createdAt: string;
}

function dwellMinutes(event: EventDocumentV2): number {
  if (!event.schedule.endsAt) return 60;
  return Math.max(
    0,
    Math.min(
      24 * 60,
      Math.round((Date.parse(event.schedule.endsAt) - Date.parse(event.schedule.startsAt)) / 60_000)
    )
  );
}

export function eventToPlanStop(
  event: EventDocumentV2,
  id = `event-stop:${event.id}`
): Omit<PlanStopV2, "order"> {
  const constraints: Record<string, JsonValue> = {
    kind: "event",
    eventId: event.id,
    eventStatus: event.status,
    eventTimezone: event.schedule.timezone,
    sourceIds: event.sources.map((source) => `${source.providerId}:${source.sourceId}`)
  };
  if (event.ticketUrl) constraints.ticketUrl = event.ticketUrl;
  if (event.officialUrl) constraints.officialUrl = event.officialUrl;
  return {
    id,
    name: event.title,
    location: structuredClone(event.venue.location),
    sourceFeatureId: event.id,
    arrivalAt: event.schedule.startsAt,
    departureAt: event.schedule.endsAt ?? null,
    dwellMinutes: dwellMinutes(event),
    notes:
      [event.venue.name, event.status === "scheduled" ? null : `Stav: ${event.status}`, event.notes]
        .filter(Boolean)
        .join(" · ") || null,
    status: "accepted",
    locked: true,
    constraints
  };
}

export function addEventToPlan(
  plan: PlanDocumentV2,
  event: EventDocumentV2,
  options: { commandId?: string; stopId?: string; now?: () => string } = {}
): { plan: PlanDocumentV2; added: boolean } {
  if (plan.stops.some((stop) => stop.sourceFeatureId === event.id)) {
    return { plan, added: false };
  }
  const stop = eventToPlanStop(event, options.stopId);
  const result = applyPlanCommand(
    plan,
    {
      id: options.commandId ?? `add-event:${event.id}:${plan.revision}`,
      expectedRevision: plan.revision,
      command: {
        type: "add-stop",
        index: Math.max(0, plan.stops.length - 1),
        stop
      }
    },
    { now: options.now }
  );
  return { plan: result.plan, added: true };
}

export function createEventPlanStopDraft(
  event: EventDocumentV2,
  now = new Date().toISOString()
): EventPlanStopDraft {
  return {
    schema: "mapos.event-plan-stop-draft",
    schemaVersion: "2.0.0",
    eventId: event.id,
    stop: eventToPlanStop(event),
    createdAt: now
  };
}

/** A valid one-stop draft lets the current Planning UI receive the event immediately. */
export function createEventPlanDocument(
  event: EventDocumentV2,
  options: { id?: string; now?: string } = {}
): PlanDocumentV2 {
  const now = options.now ?? new Date().toISOString();
  return {
    schema: "mapos.plan",
    schemaVersion: "2.0.0",
    id: options.id ?? `plan:event:${event.id}`,
    revision: 1,
    name: event.title,
    description: `Plán vytvořený z události ${event.title}`,
    status: "draft",
    visibility: "private",
    timezone: event.schedule.timezone,
    departureAt: event.schedule.startsAt,
    routePolicy: { profile: "car", preference: "fast" },
    stops: [{ ...eventToPlanStop(event), order: 0 }],
    segments: [],
    activatedLayerIds: ["events"],
    metadata: { sourceEventId: event.id },
    createdAt: now,
    updatedAt: now
  };
}
