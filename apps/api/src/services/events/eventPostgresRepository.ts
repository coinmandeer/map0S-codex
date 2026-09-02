import { and, asc, eq, gt, gte, ilike, inArray, lte, or, sql as dsql, type SQL } from "drizzle-orm";
import type { EventDocumentV2 } from "@mapos/layer-sdk";
import { db } from "../../db/index.js";
import {
  canonicalEvents,
  eventPerformers,
  eventSeriesRelations,
  eventSources,
  eventTicketOffers
} from "../../db/schema.js";
import type {
  EventCandidateQuery,
  EventRepository,
  EventRepositoryListResult,
  EventRepositoryQuery
} from "./eventRepository.js";

function documentFromRow(row: { document: EventDocumentV2 }): EventDocumentV2 {
  return structuredClone(row.document);
}

function boundedLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&").slice(0, 160)}%`;
}

/** Postgres adapter; canonical payload and normalized lookup columns are written atomically. */
export class PostgresEventRepository implements EventRepository {
  async get(id: string): Promise<EventDocumentV2 | null> {
    const [row] = await db
      .select({ document: canonicalEvents.document })
      .from(canonicalEvents)
      .where(eq(canonicalEvents.id, id))
      .limit(1);
    return row ? documentFromRow(row) : null;
  }

  async findBySource(providerId: string, sourceId: string): Promise<EventDocumentV2 | null> {
    const [row] = await db
      .select({ document: canonicalEvents.document })
      .from(eventSources)
      .innerJoin(canonicalEvents, eq(eventSources.eventId, canonicalEvents.id))
      .where(and(eq(eventSources.providerId, providerId), eq(eventSources.sourceId, sourceId)))
      .limit(1);
    return row ? documentFromRow(row) : null;
  }

  async findCandidates(query: EventCandidateQuery): Promise<EventDocumentV2[]> {
    const start = new Date(query.startsAt.getTime() - 6 * 60 * 60 * 1_000);
    const end = new Date(query.startsAt.getTime() + 6 * 60 * 60 * 1_000);
    const identity = [
      eq(canonicalEvents.normalizedTitle, query.normalizedTitle),
      eq(canonicalEvents.normalizedVenue, query.normalizedVenue),
      ...(query.officialUrl ? [eq(canonicalEvents.officialUrl, query.officialUrl)] : [])
    ];
    const rows = await db
      .select({ document: canonicalEvents.document })
      .from(canonicalEvents)
      .where(
        and(
          gte(canonicalEvents.startsAt, start),
          lte(canonicalEvents.startsAt, end),
          or(...identity)
        )
      )
      .limit(Math.min(25, Math.max(1, query.limit ?? 12)));
    return rows.map(documentFromRow);
  }

  async list(query: EventRepositoryQuery): Promise<EventRepositoryListResult> {
    const conditions: SQL[] = [
      gte(canonicalEvents.startsAt, query.from),
      lte(canonicalEvents.startsAt, query.to)
    ];
    if (query.bbox) {
      conditions.push(
        gte(canonicalEvents.lng, query.bbox[0]),
        lte(canonicalEvents.lng, query.bbox[2]),
        gte(canonicalEvents.lat, query.bbox[1]),
        lte(canonicalEvents.lat, query.bbox[3])
      );
    }
    if (query.statuses?.length) conditions.push(inArray(canonicalEvents.status, query.statuses));
    if (query.categories?.length) {
      conditions.push(
        or(
          ...query.categories.map(
            (category) =>
              dsql`${canonicalEvents.document} @> ${JSON.stringify({ categories: [category] })}::jsonb`
          )
        )!
      );
    }
    if (query.source) {
      conditions.push(
        dsql`EXISTS (
          SELECT 1 FROM event_sources source_match
          WHERE source_match.event_id = ${canonicalEvents.id}
            AND source_match.provider_id = ${query.source}
        )`
      );
    }
    if (query.free !== undefined) {
      conditions.push(
        dsql`${canonicalEvents.document} @> ${JSON.stringify({ price: { free: query.free } })}::jsonb`
      );
    }
    if (query.venue) conditions.push(ilike(canonicalEvents.venueName, boundedLike(query.venue)));
    if (query.search) {
      const pattern = boundedLike(query.search);
      conditions.push(
        or(
          ilike(canonicalEvents.title, pattern),
          ilike(canonicalEvents.venueName, pattern),
          dsql`EXISTS (
            SELECT 1 FROM event_performers performer_match
            WHERE performer_match.event_id = ${canonicalEvents.id}
              AND performer_match.name ILIKE ${pattern} ESCAPE '\\'
          )`
        )!
      );
    }
    if (query.cursor) {
      conditions.push(
        or(
          gt(canonicalEvents.startsAt, query.cursor.startsAt),
          and(
            eq(canonicalEvents.startsAt, query.cursor.startsAt),
            gt(canonicalEvents.id, query.cursor.id)
          )
        )!
      );
    }
    const rows = await db
      .select({ document: canonicalEvents.document })
      .from(canonicalEvents)
      .where(and(...conditions))
      .orderBy(asc(canonicalEvents.startsAt), asc(canonicalEvents.id))
      .limit(query.limit + 1);
    return {
      rows: rows.slice(0, query.limit).map(documentFromRow),
      hasMore: rows.length > query.limit
    };
  }

  async upsert(document: EventDocumentV2): Promise<EventDocumentV2> {
    const [lng, lat] = document.venue.location.coordinates;
    const createdAt = new Date(document.createdAt ?? document.sources[0]!.retrievedAt);
    const updatedAt = new Date(document.updatedAt ?? document.sources.at(-1)!.retrievedAt);
    await db.transaction(async (tx) => {
      await tx
        .insert(canonicalEvents)
        .values({
          id: document.id,
          revision: document.revision,
          title: document.title,
          normalizedTitle: document.dedupe?.fingerprint?.split("|")[0] ?? document.title,
          venueName: document.venue.name,
          normalizedVenue: document.dedupe?.fingerprint?.split("|")[1] ?? document.venue.name,
          startsAt: new Date(document.schedule.startsAt),
          endsAt: document.schedule.endsAt ? new Date(document.schedule.endsAt) : null,
          timezone: document.schedule.timezone,
          status: document.status,
          lng,
          lat,
          officialUrl: document.officialUrl ?? null,
          organizerName: document.organizer?.name ?? null,
          normalizedOrganizer: document.organizer?.name?.toLocaleLowerCase("en") ?? null,
          document,
          createdAt,
          updatedAt
        })
        .onConflictDoUpdate({
          target: canonicalEvents.id,
          set: {
            revision: document.revision,
            title: document.title,
            normalizedTitle: document.dedupe?.fingerprint?.split("|")[0] ?? document.title,
            venueName: document.venue.name,
            normalizedVenue: document.dedupe?.fingerprint?.split("|")[1] ?? document.venue.name,
            startsAt: new Date(document.schedule.startsAt),
            endsAt: document.schedule.endsAt ? new Date(document.schedule.endsAt) : null,
            timezone: document.schedule.timezone,
            status: document.status,
            lng,
            lat,
            officialUrl: document.officialUrl ?? null,
            organizerName: document.organizer?.name ?? null,
            normalizedOrganizer: document.organizer?.name?.toLocaleLowerCase("en") ?? null,
            document,
            updatedAt
          }
        });
      await tx
        .update(canonicalEvents)
        .set({ geog: dsql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography` })
        .where(eq(canonicalEvents.id, document.id));

      await tx.delete(eventPerformers).where(eq(eventPerformers.eventId, document.id));
      await tx.delete(eventTicketOffers).where(eq(eventTicketOffers.eventId, document.id));
      await tx.delete(eventSeriesRelations).where(eq(eventSeriesRelations.eventId, document.id));

      if (document.performers?.length) {
        await tx.insert(eventPerformers).values(
          document.performers.map((performer) => ({
            eventId: document.id,
            name: performer.name,
            normalizedName: performer.name.toLocaleLowerCase("en"),
            role: performer.role ?? null,
            url: performer.url ?? null
          }))
        );
      }
      if (document.ticketOffers?.length) {
        await tx.insert(eventTicketOffers).values(
          document.ticketOffers.map((offer) => ({
            eventId: document.id,
            sourceId: offer.sourceId,
            url: offer.url,
            label: offer.label ?? null,
            currency: offer.currency ?? null,
            minPrice: offer.min ?? null,
            maxPrice: offer.max ?? null,
            availability: offer.availability ?? "unknown"
          }))
        );
      }
      if (document.schedule.seriesId) {
        await tx.insert(eventSeriesRelations).values({
          eventId: document.id,
          externalSeriesId: document.schedule.seriesId,
          relationType: "occurrence-of"
        });
      }
      for (const source of document.sources) {
        await tx
          .insert(eventSources)
          .values({
            eventId: document.id,
            providerId: source.providerId,
            sourceId: source.sourceId,
            sourceUrl: source.url ?? null,
            attribution: source.attribution ?? source.providerId,
            license: source.license ?? null,
            confidence: source.confidence ?? null,
            retrievedAt: new Date(source.retrievedAt),
            payload: source as unknown as Record<string, unknown>
          })
          .onConflictDoUpdate({
            target: [eventSources.providerId, eventSources.sourceId],
            set: {
              eventId: document.id,
              sourceUrl: source.url ?? null,
              attribution: source.attribution ?? source.providerId,
              license: source.license ?? null,
              confidence: source.confidence ?? null,
              retrievedAt: new Date(source.retrievedAt),
              payload: source as unknown as Record<string, unknown>
            }
          });
      }
    });
    return structuredClone(document);
  }
}

export const postgresEventRepository = new PostgresEventRepository();
