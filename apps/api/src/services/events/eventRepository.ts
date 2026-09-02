import type { EventDocumentV2, EventStatusV2 } from "@mapos/layer-sdk";

export interface EventCursor {
  startsAt: Date;
  id: string;
}

export interface EventRepositoryQuery {
  bbox?: [number, number, number, number];
  from: Date;
  to: Date;
  categories?: string[];
  statuses?: EventStatusV2[];
  source?: string;
  free?: boolean;
  venue?: string;
  search?: string;
  limit: number;
  cursor?: EventCursor;
}

export interface EventCandidateQuery {
  normalizedTitle: string;
  normalizedVenue: string;
  startsAt: Date;
  officialUrl?: string | null;
  /** Candidate search must remain narrow even when upstream input is hostile. */
  limit?: number;
}

export interface EventRepositoryListResult {
  rows: EventDocumentV2[];
  hasMore: boolean;
}

export interface EventRepository {
  get(id: string): Promise<EventDocumentV2 | null>;
  findBySource(providerId: string, sourceId: string): Promise<EventDocumentV2 | null>;
  findCandidates(query: EventCandidateQuery): Promise<EventDocumentV2[]>;
  list(query: EventRepositoryQuery): Promise<EventRepositoryListResult>;
  upsert(document: EventDocumentV2): Promise<EventDocumentV2>;
}
