import { createHash } from "node:crypto";
import {
  MAPOS_V2_SCHEMA_VERSION,
  assertEventDocumentV2,
  featureQueryResult,
  type EventDocumentV2,
  type EventSourceV2,
  type EventStatusV2,
  type FeatureQueryResultV2,
  type JsonValue,
  type MapOSFeatureV2
} from "@mapos/layer-sdk";
import type { EventCursor, EventRepository, EventRepositoryQuery } from "./eventRepository.js";

export const EVENT_LIST_MAX_LIMIT = 100;
const DEFAULT_EVENT_WINDOW_DAYS = 365;
const MAX_EVENT_WINDOW_DAYS = 366;

export interface EventAdapterQuery {
  bbox: [number, number, number, number];
  from: string;
  to: string;
  keyword?: string;
  category?: string;
}

export interface EventAdapter {
  id: string;
  load(query: EventAdapterQuery): Promise<EventDocumentV2[]>;
}

export interface EventListInput {
  bbox?: [number, number, number, number];
  from?: string;
  to?: string;
  category?: string | string[];
  status?: string | string[];
  source?: string;
  free?: boolean | string;
  venue?: string;
  q?: string;
  limit?: number | string;
  cursor?: string;
  refresh?: boolean;
}

export interface EventListResult {
  events: EventDocumentV2[];
  meta: {
    limit: number;
    returned: number;
    nextCursor: string | null;
    sources: string[];
    unavailableSources: string[];
  };
}

export interface EventSourceGate {
  id: string;
  enabled: boolean;
  role: "canonical-ingest" | "enrichment-only";
  reason: string;
}

/** No implicit scraping: every future source remains closed until its explicit contract gate. */
export const EVENT_SOURCE_GATES: readonly EventSourceGate[] = [
  {
    id: "ticketmaster",
    enabled: false,
    role: "canonical-ingest",
    reason: "configured-api-key-required"
  },
  {
    id: "partner-official",
    enabled: false,
    role: "canonical-ingest",
    reason: "partner-contract-required"
  },
  {
    id: "ics",
    enabled: false,
    role: "canonical-ingest",
    reason: "registered-feed-and-terms-required"
  },
  {
    id: "schema-org",
    enabled: false,
    role: "canonical-ingest",
    reason: "terms-and-indexing-review-required"
  },
  { id: "goout", enabled: false, role: "canonical-ingest", reason: "partner-api-required" },
  {
    id: "facebook",
    enabled: false,
    role: "canonical-ingest",
    reason: "authorized-api-required-never-scrape"
  },
  {
    id: "ai",
    enabled: false,
    role: "enrichment-only",
    reason: "citations-and-expiry-required-never-canonical-ingest"
  }
] as const;

const STATUS_VALUES: ReadonlySet<EventStatusV2> = new Set([
  "scheduled",
  "postponed",
  "cancelled",
  "rescheduled",
  "completed",
  "unknown"
]);

export function normalizeEventText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function eventDedupeFingerprint(event: EventDocumentV2): string {
  const instant = new Date(event.schedule.startsAt).toISOString().slice(0, 16);
  return [normalizeEventText(event.title), normalizeEventText(event.venue.name), instant].join("|");
}

function canonicalId(event: EventDocumentV2): string {
  const identity =
    event.sources.map((source) => `${source.providerId}:${source.sourceId}`).sort()[0] ??
    eventDedupeFingerprint(event);
  return `event:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function mergeByKey<T>(
  first: readonly T[] = [],
  second: readonly T[] = [],
  key: (item: T) => string
): T[] {
  const rows = new Map<string, T>();
  for (const item of [...first, ...second]) rows.set(key(item), item);
  return [...rows.values()];
}

function candidateScore(incoming: EventDocumentV2, candidate: EventDocumentV2): number {
  let score = 0;
  if (normalizeEventText(incoming.title) === normalizeEventText(candidate.title)) score += 4;
  if (normalizeEventText(incoming.venue.name) === normalizeEventText(candidate.venue.name))
    score += 3;
  const timeDelta = Math.abs(
    Date.parse(incoming.schedule.startsAt) - Date.parse(candidate.schedule.startsAt)
  );
  if (timeDelta <= 2 * 60 * 60 * 1_000) score += 2;
  if (incoming.officialUrl && incoming.officialUrl === candidate.officialUrl) score += 6;
  if (
    incoming.organizer?.name &&
    candidate.organizer?.name &&
    normalizeEventText(incoming.organizer.name) === normalizeEventText(candidate.organizer.name)
  ) {
    score += 1;
  }
  const performers = new Set(
    candidate.performers?.map((performer) => normalizeEventText(performer.name)) ?? []
  );
  if (
    incoming.performers?.some((performer) => performers.has(normalizeEventText(performer.name)))
  ) {
    score += 2;
  }
  return score;
}

function mergeEvent(
  incoming: EventDocumentV2,
  existing: EventDocumentV2 | null,
  now: string
): EventDocumentV2 {
  const id = existing?.id ?? canonicalId(incoming);
  const startMoved =
    existing !== null &&
    Math.abs(Date.parse(existing.schedule.startsAt) - Date.parse(incoming.schedule.startsAt)) >
      15 * 60 * 1_000;
  const status = startMoved && incoming.status === "scheduled" ? "rescheduled" : incoming.status;
  const sources = mergeByKey(
    existing?.sources,
    incoming.sources,
    (source) => `${source.providerId}\u0000${source.sourceId}`
  );
  const document: EventDocumentV2 = {
    ...existing,
    ...incoming,
    schema: "mapos.event",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id,
    revision: existing ? existing.revision + 1 : Math.max(1, incoming.revision),
    status,
    categories: uniqueText([...(existing?.categories ?? []), ...incoming.categories]),
    performers: mergeByKey(existing?.performers, incoming.performers, (performer) =>
      normalizeEventText(performer.name)
    ),
    ticketOffers: mergeByKey(
      existing?.ticketOffers,
      incoming.ticketOffers,
      (offer) => `${offer.sourceId}\u0000${offer.url}`
    ),
    sources,
    dedupe: {
      fingerprint: eventDedupeFingerprint(incoming),
      mergedEventIds: uniqueText([
        ...(existing?.dedupe?.mergedEventIds ?? []),
        ...sources.map((source) => `${source.providerId}:${source.sourceId}`)
      ])
    },
    createdAt: existing?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now
  };
  assertEventDocumentV2(document);
  return document;
}

function parseDate(value: string | undefined, fallback: Date, field: string): Date {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a date-time.`);
  return date;
}

function parseList(value: string | string[] | undefined): string[] | undefined {
  const values = (Array.isArray(value) ? value : value?.split(","))
    ?.map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? uniqueText(values) : undefined;
}

export function normalizeEventLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(EVENT_LIST_MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

export function encodeEventCursor(document: EventDocumentV2): string {
  return Buffer.from(
    JSON.stringify({ startsAt: document.schedule.startsAt, id: document.id }),
    "utf8"
  ).toString("base64url");
}

export function decodeEventCursor(value: string | undefined): EventCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("startsAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.startsAt !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.startsAt))
    ) {
      throw new Error("invalid");
    }
    return { startsAt: new Date(parsed.startsAt), id: parsed.id };
  } catch {
    throw new TypeError("cursor is invalid.");
  }
}

function providerFields(event: EventDocumentV2): Record<string, JsonValue> {
  const fields: Record<string, JsonValue> = {
    eventId: event.id,
    startsAt: event.schedule.startsAt,
    timezone: event.schedule.timezone,
    status: event.status,
    venue: event.venue.name,
    categories: event.categories,
    sources: event.sources.map((source) => source.providerId)
  };
  if (event.schedule.endsAt) fields.endsAt = event.schedule.endsAt;
  if (event.price?.free !== undefined) fields.free = event.price.free;
  if (event.price?.min != null) fields.priceFrom = event.price.min;
  if (event.price?.max != null) fields.priceTo = event.price.max;
  if (event.price?.currency) fields.currency = event.price.currency;
  if (event.officialUrl) fields.officialUrl = event.officialUrl;
  if (event.ticketUrl) fields.ticketUrl = event.ticketUrl;
  return fields;
}

export function eventToMapOSFeature(event: EventDocumentV2): MapOSFeatureV2 {
  const createdAt = event.createdAt ?? event.sources[0]!.retrievedAt;
  const updatedAt = event.updatedAt ?? event.sources.at(-1)!.retrievedAt;
  return {
    schema: "mapos.feature",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: event.id,
    revision: event.revision,
    geometry: structuredClone(event.venue.location),
    properties: {
      title: event.title,
      kind: "event",
      category: event.categories[0] ?? "event",
      layerIds: ["events"],
      description: event.description ?? null,
      address: event.venue.address ?? null,
      tags: event.categories,
      urls: [
        ...(event.officialUrl
          ? [{ label: "Official", url: event.officialUrl, kind: "official" as const }]
          : []),
        ...(event.ticketUrl
          ? [{ label: "Tickets", url: event.ticketUrl, kind: "booking" as const }]
          : [])
      ],
      media: event.media?.map((media, index) => ({
        id: `${event.id}:media:${index}`,
        type: media.type ?? "image",
        url: media.url,
        credit: media.credit ?? undefined,
        license: media.license ?? undefined,
        sourceId: media.sourceId ?? undefined
      })),
      temporal: {
        startsAt: event.schedule.startsAt,
        endsAt: event.schedule.endsAt ?? null,
        timezone: event.schedule.timezone,
        live:
          event.status === "scheduled" &&
          Date.parse(event.schedule.startsAt) <= Date.now() &&
          Date.parse(event.schedule.endsAt ?? event.schedule.startsAt) >= Date.now()
      },
      providerFields: { canonical: providerFields(event) }
    },
    sources: event.sources.map((source: EventSourceV2) => ({
      providerId: source.providerId,
      sourceId: source.sourceId,
      originalUrl: source.url,
      retrievedAt: source.retrievedAt,
      confidence: source.confidence ?? 0.8,
      attribution: source.attribution ?? source.providerId,
      license: source.license,
      rights: "restricted-display"
    })),
    access: { visibility: "public", permissions: ["view", "share"] },
    createdAt,
    updatedAt
  };
}

export class EventService {
  constructor(
    private readonly repository: EventRepository,
    private readonly adapters: readonly EventAdapter[] = [],
    private readonly clock: () => Date = () => new Date()
  ) {}

  async ingest(incoming: EventDocumentV2): Promise<EventDocumentV2> {
    assertEventDocumentV2(incoming);
    let existing: EventDocumentV2 | null = null;
    for (const source of incoming.sources) {
      existing = await this.repository.findBySource(source.providerId, source.sourceId);
      if (existing) break;
    }
    if (!existing) {
      const candidates = await this.repository.findCandidates({
        normalizedTitle: normalizeEventText(incoming.title),
        normalizedVenue: normalizeEventText(incoming.venue.name),
        startsAt: new Date(incoming.schedule.startsAt),
        officialUrl: incoming.officialUrl,
        limit: 12
      });
      existing =
        candidates
          .map((candidate) => ({ candidate, score: candidateScore(incoming, candidate) }))
          .filter(({ score }) => score >= 8)
          .sort((left, right) => right.score - left.score)[0]?.candidate ?? null;
    }
    return this.repository.upsert(mergeEvent(incoming, existing, this.clock().toISOString()));
  }

  private query(input: EventListInput): EventRepositoryQuery {
    const now = this.clock();
    const from = parseDate(input.from, now, "from");
    const to = parseDate(
      input.to,
      new Date(from.getTime() + DEFAULT_EVENT_WINDOW_DAYS * 86_400_000),
      "to"
    );
    if (to < from) throw new TypeError("to must not precede from.");
    if (to.getTime() - from.getTime() > MAX_EVENT_WINDOW_DAYS * 86_400_000) {
      throw new TypeError(`event window must not exceed ${MAX_EVENT_WINDOW_DAYS} days.`);
    }
    const statuses = parseList(input.status);
    if (statuses?.some((status) => !STATUS_VALUES.has(status as EventStatusV2))) {
      throw new TypeError("status is not supported.");
    }
    const free =
      input.free === undefined
        ? undefined
        : input.free === true || input.free === "true"
          ? true
          : input.free === false || input.free === "false"
            ? false
            : (() => {
                throw new TypeError("free must be boolean.");
              })();
    return {
      bbox: input.bbox,
      from,
      to,
      categories: parseList(input.category),
      statuses: statuses as EventStatusV2[] | undefined,
      source: input.source?.trim() || undefined,
      free,
      venue: input.venue?.trim() || undefined,
      search: input.q?.trim() || undefined,
      limit: normalizeEventLimit(input.limit),
      cursor: decodeEventCursor(input.cursor)
    };
  }

  async list(input: EventListInput): Promise<EventListResult> {
    const query = this.query(input);
    const unavailableSources: string[] = [];
    if (input.refresh && input.bbox) {
      const adapterQuery: EventAdapterQuery = {
        bbox: input.bbox,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        keyword: query.search,
        category: query.categories?.[0]
      };
      for (const adapter of this.adapters) {
        try {
          for (const event of await adapter.load(adapterQuery)) await this.ingest(event);
        } catch {
          // A provider outage must not hide canonical rows already verified and stored locally.
          unavailableSources.push(adapter.id);
        }
      }
    }
    const result = await this.repository.list(query);
    const last = result.rows.at(-1);
    return {
      events: result.rows,
      meta: {
        limit: query.limit,
        returned: result.rows.length,
        nextCursor: result.hasMore && last ? encodeEventCursor(last) : null,
        sources: uniqueText(
          result.rows.flatMap((event) => event.sources.map((source) => source.providerId))
        ),
        unavailableSources: uniqueText(unavailableSources)
      }
    };
  }

  get(id: string): Promise<EventDocumentV2 | null> {
    return this.repository.get(id);
  }

  sourceGates(): EventSourceGate[] {
    const active = new Set(this.adapters.map((adapter) => adapter.id));
    return EVENT_SOURCE_GATES.map((gate) => ({
      ...gate,
      enabled: gate.id === "ticketmaster" ? active.has(gate.id) : gate.enabled
    }));
  }

  async features(input: EventListInput): Promise<FeatureQueryResultV2> {
    const result = await this.list(input);
    const ready = result.meta.sources.filter(
      (providerId) => !result.meta.unavailableSources.includes(providerId)
    );
    return featureQueryResult({
      features: result.events.map(eventToMapOSFeature),
      requestedLimit: result.meta.limit,
      availableCount: result.events.length + (result.meta.nextCursor ? 1 : 0),
      nextCursor: result.meta.nextCursor,
      sources: [
        ...ready.map((providerId) => ({ providerId, state: "ready" as const })),
        ...result.meta.unavailableSources.map((providerId) => ({
          providerId,
          state: "unavailable" as const
        }))
      ],
      notices: result.meta.unavailableSources.map((providerId) => ({
        code: "event-source-unavailable",
        message: `${providerId} je dočasně nedostupný; zobrazuji uložené ověřené události.`,
        severity: "warning"
      }))
    });
  }
}
