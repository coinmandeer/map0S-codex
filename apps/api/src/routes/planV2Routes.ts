import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PlanCommandError,
  applyPlanCommand,
  assertPlanCommandEnvelopeV2,
  assertPlanDocumentV2,
  type DataProvider,
  type PlanCommandEnvelopeV2,
  type PlanDocumentV2,
  type PlanTemporalContextV2
} from "@mapos/layer-sdk";
import { ClientError, messageForClient, statusForClient } from "../utils/clientError.js";
import type { PlanDocumentRepository } from "../services/planDocumentRepository.js";
import type { PlanShareRepository } from "../services/planShareRepository.js";
import {
  createPlanShareToken,
  hashPlanShareToken,
  PLAN_SHARE_TOKEN_PATTERN,
  projectPlanForShare
} from "../services/planShareService.js";
import {
  exportPlanGeoJson,
  exportPlanGpx,
  exportPlanKml,
  exportPlanMapOsJson
} from "../services/planExportService.js";
import {
  routePlanSegments,
  type AdjacentRouteProvider
} from "../services/segmentRoutingService.js";
import {
  buildAdventureCorridors,
  recommendAdventureRoute,
  type AdventureCorridorQuery,
  type AdventurePlaceSearchResult
} from "../services/adventureRoutingService.js";
import { FixedWindowRateLimiter, rateLimitByIp } from "../security/publicApiHardening.js";
import { buildPlanTemporalContext } from "../services/planTemporalContextService.js";

const ROUTE_REQUEST_STOP_BUDGET = 250;

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  maxProperties: 0,
  additionalProperties: false
} as const;

const PLAN_BODY_SCHEMA = {
  // The SDK performs the semantic/deep PlanDocument v2 validation. The transport first caps the
  // byte size and top-level fan-out so malformed JSON cannot bypass a finite request envelope.
  type: "object",
  minProperties: 1,
  maxProperties: 32
} as const;

const PLAN_ID_PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 160 } }
} as const;

const PLAN_SHARE_PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "shareId"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 160 },
    shareId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

const PLAN_SHARE_TOKEN_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: { type: "string", minLength: 43, maxLength: 43, pattern: PLAN_SHARE_TOKEN_PATTERN }
  }
} as const;

const PLAN_INPUT_SCHEMA = {
  params: EMPTY_OBJECT_SCHEMA,
  querystring: EMPTY_OBJECT_SCHEMA,
  body: PLAN_BODY_SCHEMA
} as const;

const PLAN_ITEM_SCHEMA = {
  params: PLAN_ID_PARAMS_SCHEMA,
  querystring: EMPTY_OBJECT_SCHEMA
} as const;

export interface PlanV2RouteDependencies {
  repository: PlanDocumentRepository;
  shareRepository: PlanShareRepository;
  resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
  providerFor(provider: DataProvider): AdjacentRouteProvider;
  findAdventurePlaces?(
    corridors: readonly AdventureCorridorQuery[]
  ): Promise<AdventurePlaceSearchResult>;
  temporalContextForPlan?(
    plan: PlanDocumentV2,
    provider: DataProvider
  ): Promise<PlanTemporalContextV2>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planFromBody(body: unknown, enforceRoutingBudget = false): PlanDocumentV2 {
  const value = record(body) && "plan" in body ? body.plan : body;
  try {
    assertPlanDocumentV2(value);
  } catch {
    throw new ClientError("Neplatný formát PlanDocument v2", 400);
  }
  if (enforceRoutingBudget && value.stops.length > ROUTE_REQUEST_STOP_BUDGET) {
    throw new ClientError(
      `Jedno interaktivní trasování může zpracovat nejvýše ${ROUTE_REQUEST_STOP_BUDGET} zastávek`,
      400
    );
  }
  return value;
}

function expectedRevision(body: unknown): number {
  if (!record(body) || !Number.isInteger(body.expectedRevision)) {
    throw new ClientError("Chybí platná očekávaná revize plánu", 400);
  }
  return Number(body.expectedRevision);
}

function commandFromBody(body: unknown): PlanCommandEnvelopeV2 {
  try {
    assertPlanCommandEnvelopeV2(body);
    return body;
  } catch (error) {
    if (error instanceof PlanCommandError) throw error;
    throw new ClientError("Neplatný plánovací příkaz", 400);
  }
}

function commandClientError(error: PlanCommandError): ClientError {
  const status =
    error.code === "REVISION_CONFLICT" ? 409 : error.code.endsWith("_NOT_FOUND") ? 404 : 400;
  return new ClientError(error.message, status);
}

async function authenticatedOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: PlanV2RouteDependencies
): Promise<string | null> {
  const ownerId = await dependencies.resolveUserId(request);
  if (!ownerId) {
    await reply.code(401).send({ message: "Unauthorized" });
    return null;
  }
  return ownerId;
}

function sendPlanningError(reply: FastifyReply, error: unknown, fallback: string) {
  const clientError = error instanceof PlanCommandError ? commandClientError(error) : error;
  return reply
    .code(statusForClient(clientError))
    .send({ message: messageForClient(clientError, fallback) });
}

export function registerPlanV2Routes(
  app: FastifyInstance,
  dependencies: PlanV2RouteDependencies
): void {
  const publicShareLimiter = new FixedWindowRateLimiter();
  app.post<{ Body: unknown }>(
    "/v2/routing/adventure",
    {
      schema: {
        params: EMPTY_OBJECT_SCHEMA,
        querystring: EMPTY_OBJECT_SCHEMA,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["plan", "detourLimitPercent"],
          properties: {
            plan: PLAN_BODY_SCHEMA,
            provider: { type: "string", enum: ["osm", "mapy"] },
            detourLimitPercent: { type: "integer", minimum: 5, maximum: 30 },
            maximumSuggestions: { type: "integer", minimum: 1, maximum: 3 }
          }
        }
      },
      bodyLimit: 4 * 1024 * 1024
    },
    async (request, reply) => {
      try {
        const plan = planFromBody(request.body);
        if (plan.routePolicy.preference !== "adventure") {
          throw new ClientError("Nejprve zvol profil Dobrodružná", 400);
        }
        const body = request.body as {
          provider?: DataProvider;
          detourLimitPercent: number;
          maximumSuggestions?: number;
        };
        const provider = body.provider === "mapy" ? "mapy" : "osm";
        const corridors = buildAdventureCorridors(plan, body.detourLimitPercent);
        const search = dependencies.findAdventurePlaces
          ? await dependencies.findAdventurePlaces(corridors)
          : { places: [], sourceStates: [] };
        return await recommendAdventureRoute(plan, search, dependencies.providerFor(provider), {
          detourLimitPercent: body.detourLimitPercent,
          maximumSuggestions: body.maximumSuggestions
        });
      } catch (error) {
        return sendPlanningError(reply, error, "Dobrodružnou trasu nelze připravit");
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/v2/routing/plan",
    { schema: PLAN_INPUT_SCHEMA, bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      try {
        const plan = planFromBody(request.body, true);
        const provider = record(request.body) && request.body.provider === "mapy" ? "mapy" : "osm";
        return await routePlanSegments(plan, dependencies.providerFor(provider), {
          concurrency: 4
        });
      } catch (error) {
        return sendPlanningError(reply, error, "Plánování trasy je dočasně nedostupné");
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/v2/routing/temporal-context",
    { schema: PLAN_INPUT_SCHEMA, bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      try {
        // Context scans linearly and samples at most 20 stops; it does not inherit an external
        // routing provider's waypoint transport budget.
        const plan = planFromBody(request.body);
        const provider = record(request.body) && request.body.provider === "mapy" ? "mapy" : "osm";
        return dependencies.temporalContextForPlan
          ? await dependencies.temporalContextForPlan(plan, provider)
          : await buildPlanTemporalContext(plan, provider);
      } catch (error) {
        return sendPlanningError(reply, error, "Časový kontext trasy je dočasně nedostupný");
      }
    }
  );

  app.post<{ Params: { format: string }; Body: unknown }>(
    "/v2/plans/export/:format",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["format"],
          properties: { format: { type: "string", enum: ["gpx", "geojson", "kml", "mapos"] } }
        },
        querystring: EMPTY_OBJECT_SCHEMA,
        body: PLAN_BODY_SCHEMA
      },
      bodyLimit: 4 * 1024 * 1024
    },
    async (request, reply) => {
      try {
        const plan = planFromBody(request.body);
        if (request.params.format === "gpx") {
          return {
            filename: `${plan.id}.gpx`,
            mimeType: "application/gpx+xml",
            content: exportPlanGpx(plan)
          };
        }
        if (request.params.format === "geojson") {
          return {
            filename: `${plan.id}.geojson`,
            mimeType: "application/geo+json",
            content: exportPlanGeoJson(plan)
          };
        }
        if (request.params.format === "kml") {
          return {
            filename: `${plan.id}.kml`,
            mimeType: "application/vnd.google-earth.kml+xml",
            content: exportPlanKml(plan)
          };
        }
        if (request.params.format === "mapos") {
          return {
            filename: `${plan.id}.mapos.json`,
            mimeType: "application/json",
            content: exportPlanMapOsJson(plan)
          };
        }
        throw new ClientError("Podporované exporty jsou GPX, GeoJSON, KML a MapOS JSON", 400);
      } catch (error) {
        return sendPlanningError(reply, error, "Plán nelze exportovat");
      }
    }
  );

  app.get(
    "/v2/plans",
    { schema: { params: EMPTY_OBJECT_SCHEMA, querystring: EMPTY_OBJECT_SCHEMA } },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      return { plans: await dependencies.repository.list(ownerId) };
    }
  );

  app.post<{ Body: { token: string } }>(
    "/v2/plans/shared/resolve",
    {
      schema: {
        params: EMPTY_OBJECT_SCHEMA,
        querystring: EMPTY_OBJECT_SCHEMA,
        body: PLAN_SHARE_TOKEN_BODY_SCHEMA
      },
      bodyLimit: 2 * 1024,
      preHandler: rateLimitByIp(publicShareLimiter, {
        bucket: "public-plan-share",
        limit: 60,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      const resolved = await dependencies.shareRepository.resolve(
        hashPlanShareToken(request.body.token)
      );
      if (!resolved) {
        return reply
          .header("cache-control", "no-store")
          .code(404)
          .send({ message: "Sdílený plán nebyl nalezen nebo byl odvolán" });
      }
      return reply.header("cache-control", "no-store").send({
        permission: resolved.share.permission,
        plan: projectPlanForShare(resolved.plan)
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/v2/plans/:id",
    { schema: PLAN_ITEM_SCHEMA },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      const plan = await dependencies.repository.get(ownerId, request.params.id);
      if (!plan) return reply.code(404).send({ message: "Plán nebyl nalezen" });
      return { plan };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/v2/plans/:id/shares",
    { schema: PLAN_ITEM_SCHEMA },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      const plan = await dependencies.repository.get(ownerId, request.params.id);
      if (!plan) return reply.code(404).send({ message: "Plán nebyl nalezen" });
      return reply.header("cache-control", "private, no-store").send({
        shares: await dependencies.shareRepository.list(ownerId, plan.id)
      });
    }
  );

  app.post<{ Params: { id: string }; Body: { permission: "view" } }>(
    "/v2/plans/:id/shares",
    {
      schema: {
        ...PLAN_ITEM_SCHEMA,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["permission"],
          properties: { permission: { const: "view" } }
        }
      },
      bodyLimit: 4 * 1024
    },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      const plan = await dependencies.repository.get(ownerId, request.params.id);
      if (!plan) return reply.code(404).send({ message: "Plán nebyl nalezen" });
      const token = createPlanShareToken();
      const share = await dependencies.shareRepository.create(
        ownerId,
        plan.id,
        hashPlanShareToken(token),
        request.body.permission
      );
      return reply.header("cache-control", "private, no-store").send({ share, token });
    }
  );

  app.delete<{ Params: { id: string; shareId: string } }>(
    "/v2/plans/:id/shares/:shareId",
    {
      schema: {
        params: PLAN_SHARE_PARAMS_SCHEMA,
        querystring: EMPTY_OBJECT_SCHEMA
      }
    },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      const plan = await dependencies.repository.get(ownerId, request.params.id);
      if (!plan) return reply.code(404).send({ message: "Plán nebyl nalezen" });
      try {
        await dependencies.shareRepository.revoke(ownerId, plan.id, request.params.shareId);
        return reply.header("cache-control", "private, no-store").code(204).send();
      } catch (error) {
        return sendPlanningError(reply, error, "Odkaz nelze odvolat");
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/v2/plans",
    { schema: PLAN_INPUT_SCHEMA, bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      try {
        return { plan: await dependencies.repository.create(ownerId, planFromBody(request.body)) };
      } catch (error) {
        return sendPlanningError(reply, error, "Plán nelze uložit");
      }
    }
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/v2/plans/:id",
    {
      schema: { ...PLAN_ITEM_SCHEMA, body: PLAN_BODY_SCHEMA },
      bodyLimit: 4 * 1024 * 1024
    },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      try {
        return {
          plan: await dependencies.repository.replace(
            ownerId,
            request.params.id,
            planFromBody(request.body),
            expectedRevision(request.body)
          )
        };
      } catch (error) {
        return sendPlanningError(reply, error, "Plán nelze upravit");
      }
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/v2/plans/:id/commands",
    {
      schema: {
        ...PLAN_ITEM_SCHEMA,
        body: { type: "object", minProperties: 3, maxProperties: 6 }
      },
      bodyLimit: 256 * 1024
    },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      try {
        const command = commandFromBody(request.body);
        const current = await dependencies.repository.get(ownerId, request.params.id);
        if (!current) throw new ClientError("Plán nebyl nalezen", 404);
        const applied = applyPlanCommand(current, { ...command, actorId: ownerId });
        const plan = await dependencies.repository.replace(
          ownerId,
          request.params.id,
          applied.plan,
          current.revision
        );
        return { plan, revision: applied.revision };
      } catch (error) {
        return sendPlanningError(reply, error, "Příkaz plánu nelze použít");
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/v2/plans/:id",
    { schema: PLAN_ITEM_SCHEMA },
    async (request, reply) => {
      const ownerId = await authenticatedOwner(request, reply, dependencies);
      if (!ownerId) return;
      try {
        await dependencies.repository.delete(ownerId, request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return sendPlanningError(reply, error, "Plán nelze smazat");
      }
    }
  );
}
