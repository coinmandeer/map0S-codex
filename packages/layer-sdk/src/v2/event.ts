import { assertCompatibleSchema, type JsonValue, type VersionEnvelope } from "./common.js";
import type { Position } from "./feature.js";

export const EVENT_DOCUMENT_SCHEMA = "mapos.event" as const;

export type EventStatusV2 =
  "scheduled" | "postponed" | "cancelled" | "rescheduled" | "completed" | "unknown";

export interface EventScheduleV2 {
  startsAt: string;
  endsAt?: string | null;
  doorsAt?: string | null;
  timezone: string;
  allDay?: boolean;
  /** Provider recurrence rule. This is descriptive until an occurrence expander is configured. */
  recurrence?: string | null;
  occurrenceId?: string | null;
  seriesId?: string | null;
}

export interface EventVenueV2 {
  name: string;
  address?: string | null;
  location: { type: "Point"; coordinates: Position };
  featureId?: string | null;
  externalId?: string | null;
}

export interface EventPerformerV2 {
  name: string;
  role?: string | null;
  url?: string;
}

export interface EventOrganizerV2 {
  name: string;
  url?: string | null;
}

export interface EventPriceV2 {
  currency?: string;
  min?: number | null;
  max?: number | null;
  free?: boolean;
  note?: string | null;
}

export interface EventTicketOfferV2 {
  sourceId: string;
  label?: string | null;
  url: string;
  currency?: string | null;
  min?: number | null;
  max?: number | null;
  availability?: "available" | "limited" | "sold-out" | "cancelled" | "unknown";
}

export interface EventMediaV2 {
  url: string;
  type?: "image" | "video";
  credit?: string | null;
  license?: string | null;
  sourceId?: string | null;
}

/** Provider identity is stable and unique per provider; canonical events may retain many. */
export interface EventSourceV2 {
  providerId: string;
  sourceId: string;
  url?: string;
  retrievedAt: string;
  /** Advisory provider credit; ingestion remains available when absent. */
  attribution?: string;
  license?: string | null;
  confidence?: number;
}

export interface EventDocumentV2 extends VersionEnvelope {
  schema: typeof EVENT_DOCUMENT_SCHEMA;
  schemaVersion: string;
  revision: number;
  title: string;
  description?: string | null;
  categories: string[];
  status: EventStatusV2;
  schedule: EventScheduleV2;
  venue: EventVenueV2;
  performers?: EventPerformerV2[];
  organizer?: EventOrganizerV2 | null;
  price?: EventPriceV2 | null;
  ticketUrl?: string | null;
  officialUrl?: string | null;
  ticketOffers?: EventTicketOfferV2[];
  ageRestriction?: string | null;
  accessibility?: string[];
  notes?: string | null;
  media?: EventMediaV2[];
  sources: EventSourceV2[];
  dedupe?: { fingerprint?: string; mergedEventIds?: string[] };
  relations?: {
    rescheduledFromEventId?: string | null;
    rescheduledToEventId?: string | null;
    [key: string]: JsonValue | undefined;
  };
  createdAt?: string;
  updatedAt?: string;
}

const EVENT_STATUSES: ReadonlySet<EventStatusV2> = new Set([
  "scheduled",
  "postponed",
  "cancelled",
  "rescheduled",
  "completed",
  "unknown"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required.`);
  }
}

function dateTime(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be a date-time.`);
  }
}

function point(value: unknown): void {
  if (!record(value) || value.type !== "Point" || !Array.isArray(value.coordinates)) {
    throw new TypeError("venue.location must be a GeoJSON Point.");
  }
  const [longitude, latitude, ...rest] = value.coordinates;
  if (
    rest.length > 0 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new TypeError("venue.location coordinates must be a WGS84 position.");
  }
}

export function assertEventDocumentV2(value: unknown): asserts value is EventDocumentV2 {
  if (!record(value)) throw new TypeError("Event document must be an object.");
  text(value.schema, "schema");
  text(value.schemaVersion, "schemaVersion");
  assertCompatibleSchema(
    { schema: value.schema, schemaVersion: value.schemaVersion },
    EVENT_DOCUMENT_SCHEMA
  );
  text(value.id, "id");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) {
    throw new TypeError("revision must be a positive integer.");
  }
  text(value.title, "title");
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    throw new TypeError("categories must not be empty.");
  }
  for (const category of value.categories) text(category, "categories[]");
  if (!EVENT_STATUSES.has(value.status as EventStatusV2)) {
    throw new TypeError("status is not supported.");
  }
  if (!record(value.schedule)) throw new TypeError("schedule is required.");
  dateTime(value.schedule.startsAt, "schedule.startsAt");
  if (value.schedule.endsAt != null) dateTime(value.schedule.endsAt, "schedule.endsAt");
  if (value.schedule.doorsAt != null) dateTime(value.schedule.doorsAt, "schedule.doorsAt");
  text(value.schedule.timezone, "schedule.timezone");
  if (
    typeof value.schedule.endsAt === "string" &&
    Date.parse(value.schedule.endsAt) < Date.parse(value.schedule.startsAt)
  ) {
    throw new TypeError("schedule.endsAt must not precede schedule.startsAt.");
  }
  if (!record(value.venue)) throw new TypeError("venue is required.");
  text(value.venue.name, "venue.name");
  point(value.venue.location);
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new TypeError("sources must not be empty.");
  }
  const identities = new Set<string>();
  for (const source of value.sources) {
    if (!record(source)) throw new TypeError("sources[] must be an object.");
    text(source.providerId, "sources[].providerId");
    text(source.sourceId, "sources[].sourceId");
    if (source.attribution !== undefined) text(source.attribution, "sources[].attribution");
    dateTime(source.retrievedAt, "sources[].retrievedAt");
    if (
      source.confidence !== undefined &&
      (typeof source.confidence !== "number" || source.confidence < 0 || source.confidence > 1)
    ) {
      throw new TypeError("sources[].confidence must be between 0 and 1.");
    }
    const identity = `${source.providerId}\u0000${source.sourceId}`;
    if (identities.has(identity)) throw new TypeError("sources must have unique provider IDs.");
    identities.add(identity);
  }
}
