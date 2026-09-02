import type { Bbox, EventStatusV2 } from "@mapos/layer-sdk";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type EventListInput, type EventService } from "../services/events/eventService.js";

const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;
const EVENT_STATUS_VALUES: EventStatusV2[] = [
  "scheduled",
  "postponed",
  "cancelled",
  "rescheduled",
  "completed",
  "unknown"
];

const EVENT_QUERY_PROPERTIES = {
  bbox: { type: "string", minLength: 7, maxLength: 100 },
  from: { type: "string", format: "date-time" },
  to: { type: "string", format: "date-time" },
  category: { type: "string", maxLength: 200 },
  status: { type: "string", maxLength: 120 },
  source: { type: "string", minLength: 1, maxLength: 80 },
  free: { enum: ["true", "false"] },
  venue: { type: "string", maxLength: 160 },
  q: { type: "string", maxLength: 160 },
  limit: { type: "integer", minimum: 1 },
  cursor: { type: "string", minLength: 1, maxLength: 512 }
} as const;

export const EVENT_LIST_ROUTE_SCHEMA = {
  querystring: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    properties: EVENT_QUERY_PROPERTIES
  }
} as const;

export const EVENT_FEATURE_ROUTE_SCHEMA = {
  querystring: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["bbox"],
    properties: EVENT_QUERY_PROPERTIES
  }
} as const;

const EVENT_ID_SCHEMA = {
  params: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["id"],
    properties: { id: { type: "string", minLength: 1, maxLength: 160 } }
  }
} as const;

export interface EventRouteDependencies {
  service: Pick<EventService, "list" | "get" | "features" | "sourceGates">;
  /** Production may refresh its configured adapter; memory always keeps this false. */
  refreshProvider?: boolean;
}

function bbox(raw: string | undefined): Bbox | undefined {
  if (!raw) return undefined;
  const values = raw.split(",").map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[0]! < -180 ||
    values[2]! > 180 ||
    values[1]! < -90 ||
    values[3]! > 90 ||
    values[0]! >= values[2]! ||
    values[1]! >= values[3]!
  ) {
    throw new TypeError("bbox must be west,south,east,north");
  }
  return values as Bbox;
}

function input(
  query: Record<string, string | number | undefined>,
  refresh: boolean
): EventListInput {
  const statuses = query.status?.toString().split(",").filter(Boolean) ?? [];
  if (statuses.some((candidate) => !EVENT_STATUS_VALUES.includes(candidate as EventStatusV2))) {
    throw new TypeError("status is not supported");
  }
  return {
    bbox: bbox(query.bbox?.toString()),
    from: query.from?.toString(),
    to: query.to?.toString(),
    category: query.category?.toString(),
    status: query.status?.toString(),
    source: query.source?.toString(),
    free: query.free?.toString(),
    venue: query.venue?.toString(),
    q: query.q?.toString(),
    limit: query.limit,
    cursor: query.cursor?.toString(),
    refresh
  };
}

function invalid(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({
    message: error instanceof Error ? error.message : "Invalid event query"
  });
}

/** One registrar is composed into production and memory; only repository/adapters differ. */
export function registerEventRoutes(
  app: FastifyInstance,
  dependencies: EventRouteDependencies
): void {
  app.get<{ Querystring: Record<string, string | number | undefined> }>(
    "/v2/layers/events/features",
    { schema: EVENT_FEATURE_ROUTE_SCHEMA },
    async (request, reply) => {
      try {
        return reply
          .header("cache-control", "public, max-age=60, stale-while-revalidate=300")
          .send(
            await dependencies.service.features(
              input(request.query, dependencies.refreshProvider ?? false)
            )
          );
      } catch (error) {
        return invalid(reply, error);
      }
    }
  );

  app.get<{ Querystring: Record<string, string | number | undefined> }>(
    "/v2/events",
    { schema: EVENT_LIST_ROUTE_SCHEMA },
    async (request, reply) => {
      try {
        return reply
          .header("cache-control", "public, max-age=60, stale-while-revalidate=300")
          .send(
            await dependencies.service.list(
              input(request.query, dependencies.refreshProvider ?? false)
            )
          );
      } catch (error) {
        return invalid(reply, error);
      }
    }
  );

  app.get("/v2/events/sources", async (_request, reply) =>
    reply
      .header("cache-control", "public, max-age=300")
      .send({ sources: dependencies.service.sourceGates() })
  );

  app.get<{ Params: { id: string } }>(
    "/v2/events/:id",
    { schema: EVENT_ID_SCHEMA },
    async (request, reply) => {
      const event = await dependencies.service.get(request.params.id);
      if (!event) return reply.code(404).send({ message: "Event not found" });
      return reply.header("cache-control", "public, max-age=60").send({ event });
    }
  );
}
