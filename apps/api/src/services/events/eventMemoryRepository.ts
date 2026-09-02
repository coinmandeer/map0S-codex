import type { EventDocumentV2 } from "@mapos/layer-sdk";
import type {
  EventCandidateQuery,
  EventRepository,
  EventRepositoryListResult,
  EventRepositoryQuery
} from "./eventRepository.js";
import { normalizeEventText } from "./eventService.js";

function clone(document: EventDocumentV2): EventDocumentV2 {
  return structuredClone(document);
}

function afterCursor(document: EventDocumentV2, query: EventRepositoryQuery): boolean {
  if (!query.cursor) return true;
  const time = Date.parse(document.schedule.startsAt);
  const cursorTime = query.cursor.startsAt.getTime();
  return time > cursorTime || (time === cursorTime && document.id > query.cursor.id);
}

function inBbox(document: EventDocumentV2, bbox: [number, number, number, number]): boolean {
  const [lng, lat] = document.venue.location.coordinates;
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Process-local canonical store used by memory/offline mode and contract tests. */
export class MemoryEventRepository implements EventRepository {
  private readonly rows = new Map<string, EventDocumentV2>();

  constructor(seed: readonly EventDocumentV2[] = []) {
    for (const document of seed) this.rows.set(document.id, clone(document));
  }

  async get(id: string): Promise<EventDocumentV2 | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async findBySource(providerId: string, sourceId: string): Promise<EventDocumentV2 | null> {
    for (const row of this.rows.values()) {
      if (
        row.sources.some(
          (source) => source.providerId === providerId && source.sourceId === sourceId
        )
      ) {
        return clone(row);
      }
    }
    return null;
  }

  async findCandidates(query: EventCandidateQuery): Promise<EventDocumentV2[]> {
    const windowMs = 6 * 60 * 60 * 1_000;
    return [...this.rows.values()]
      .filter(
        (row) => Math.abs(Date.parse(row.schedule.startsAt) - query.startsAt.getTime()) <= windowMs
      )
      .filter(
        (row) =>
          normalizeEventText(row.title) === query.normalizedTitle ||
          normalizeEventText(row.venue.name) === query.normalizedVenue ||
          Boolean(query.officialUrl && row.officialUrl === query.officialUrl)
      )
      .slice(0, Math.min(25, Math.max(1, query.limit ?? 12)))
      .map(clone);
  }

  async list(query: EventRepositoryQuery): Promise<EventRepositoryListResult> {
    const from = query.from.getTime();
    const to = query.to.getTime();
    const search = query.search ? normalizeEventText(query.search) : null;
    const venue = query.venue ? normalizeEventText(query.venue) : null;
    const rows = [...this.rows.values()]
      .filter((row) => {
        const startsAt = Date.parse(row.schedule.startsAt);
        return startsAt >= from && startsAt <= to;
      })
      .filter((row) => !query.bbox || inBbox(row, query.bbox))
      .filter(
        (row) =>
          !query.categories?.length ||
          row.categories.some((item) => query.categories!.includes(item))
      )
      .filter((row) => !query.statuses?.length || query.statuses.includes(row.status))
      .filter(
        (row) => !query.source || row.sources.some((source) => source.providerId === query.source)
      )
      .filter((row) => query.free === undefined || Boolean(row.price?.free) === query.free)
      .filter((row) => !venue || normalizeEventText(row.venue.name).includes(venue))
      .filter(
        (row) =>
          !search ||
          normalizeEventText(row.title).includes(search) ||
          normalizeEventText(row.venue.name).includes(search) ||
          row.performers?.some((performer) => normalizeEventText(performer.name).includes(search))
      )
      .sort(
        (left, right) =>
          Date.parse(left.schedule.startsAt) - Date.parse(right.schedule.startsAt) ||
          left.id.localeCompare(right.id)
      )
      .filter((row) => afterCursor(row, query));
    return {
      rows: rows.slice(0, query.limit).map(clone),
      hasMore: rows.length > query.limit
    };
  }

  async upsert(document: EventDocumentV2): Promise<EventDocumentV2> {
    this.rows.set(document.id, clone(document));
    return clone(document);
  }
}
