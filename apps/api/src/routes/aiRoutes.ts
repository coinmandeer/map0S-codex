import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  FixedWindowRateLimiter,
  rateLimitByIp,
  type RequestRateLimiter
} from "../security/publicApiHardening.js";
import type {
  AiOrchestrationConversationTarget,
  AiNearestPoiMapContext,
  ProviderNeutralAiOrchestrator
} from "../services/ai/orchestrator.js";
import { assertPlanDocumentV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import type {
  PlanDiscussionAnswer,
  PlanDiscussionRequest
} from "../services/ai/planDiscussionService.js";
import type { PlanDocumentRepository } from "../services/planDocumentRepository.js";
import type { PlanDiscussionRepository } from "../services/planDiscussionRepository.js";
import { messageForClient, statusForClient } from "../utils/clientError.js";

const IDENTIFIER_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
// Fastify's AJV removes `additionalProperties: false` by default. A never-valid schema makes an
// unknown property a validation error instead of silently rewriting the authenticated request.
const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;

const identifierSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: IDENTIFIER_PATTERN
} as const;

const newConversationSchema = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["mode", "scope"],
  properties: {
    mode: { const: "new" },
    scope: {
      type: "object",
      additionalProperties: REJECT_UNKNOWN_PROPERTY,
      required: ["type"],
      properties: { type: { const: "global" } }
    }
  }
} as const;

const existingConversationSchema = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["mode", "conversationId", "baseRevision"],
  properties: {
    mode: { const: "existing" },
    conversationId: identifierSchema,
    baseRevision: { type: "integer", minimum: 0, maximum: 1_000_000 }
  }
} as const;

export const AI_ORCHESTRATION_ROUTE_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["prompt", "conversation", "reference", "activeLayerIds"],
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" },
      conversation: { oneOf: [newConversationSchema, existingConversationSchema] },
      reference: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        required: ["source", "longitude", "latitude"],
        properties: {
          source: { type: "string", enum: ["geolocation", "map-center", "explicit"] },
          longitude: { type: "number", minimum: -180, maximum: 180 },
          latitude: { type: "number", minimum: -90, maximum: 90 }
        }
      },
      activeLayerIds: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        items: identifierSchema
      },
      activeFilters: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        properties: {
          openNow: { type: "boolean" },
          minRating: { type: "number", minimum: 0, maximum: 5 },
          tags: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: identifierSchema
          }
        }
      },
      radiusMeters: { type: "number", minimum: 1, maximum: 50_000 },
      limit: { type: "integer", minimum: 1, maximum: 4 },
      preciseLocationConsent: { type: "boolean" }
    }
  }
} as const;

export interface AiOrchestrationRouteBody {
  prompt: string;
  conversation: AiOrchestrationConversationTarget;
  reference: AiNearestPoiMapContext["reference"];
  activeLayerIds: string[];
  activeFilters?: AiNearestPoiMapContext["activeFilters"];
  radiusMeters?: number;
  limit?: number;
  preciseLocationConsent?: boolean;
}

export interface AiRouteDependencies {
  orchestrator: ProviderNeutralAiOrchestrator;
  resolveUserId(request: FastifyRequest): string | null | Promise<string | null>;
  allowedLayerIds: ReadonlySet<string>;
  rateLimiter?: RequestRateLimiter;
  rateLimit?: number;
  rateLimitWindowMs?: number;
  discussPlan?: (request: PlanDiscussionRequest) => Promise<PlanDiscussionAnswer | null>;
  planRepository?: PlanDocumentRepository;
  planDiscussionRepository?: PlanDiscussionRepository;
}

function privateResponse(reply: FastifyReply) {
  return reply.header("cache-control", "private, no-store");
}

/** Authenticated HTTP boundary shared by the production and deterministic memory compositions. */
export function registerAiRoutes(app: FastifyInstance, dependencies: AiRouteDependencies) {
  const limiter = dependencies.rateLimiter ?? new FixedWindowRateLimiter();
  app.post<{ Body: AiOrchestrationRouteBody }>(
    "/v2/ai/orchestrate",
    {
      schema: AI_ORCHESTRATION_ROUTE_SCHEMA,
      bodyLimit: 32 * 1024,
      preHandler: rateLimitByIp(limiter, {
        bucket: "ai-orchestration",
        limit: dependencies.rateLimit ?? 20,
        windowMs: dependencies.rateLimitWindowMs ?? 60_000
      })
    },
    async (request, reply) => {
      const userId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!userId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }

      const outcome = await dependencies.orchestrator.run({
        ownerUserId: userId,
        conversation: request.body.conversation,
        prompt: request.body.prompt,
        promptDataClass: "account-private",
        actor: {
          authenticated: true,
          userId,
          permissions: new Set(["poi:read"]),
          entitlementIds: new Set()
        },
        projection: {
          allowedLayerIds: new Set(dependencies.allowedLayerIds),
          allowedPlanIds: new Set(),
          allowedFeatureFieldsByLayer: new Map(),
          allowedDataClasses: new Set(["public"]),
          allowPreciseLocation: request.body.preciseLocationConsent === true
        },
        mapContext: {
          reference: request.body.reference,
          activeLayerIds: request.body.activeLayerIds,
          activeFilters: request.body.activeFilters ?? {},
          ...(request.body.radiusMeters === undefined
            ? {}
            : { radiusMeters: request.body.radiusMeters }),
          ...(request.body.limit === undefined ? {} : { limit: request.body.limit })
        }
      });

      if (outcome.status === "succeeded") {
        return privateResponse(reply).send({
          status: outcome.status,
          conversation: {
            id: outcome.conversation.id,
            revision: outcome.conversation.revision,
            scope: outcome.conversation.scope
          },
          answer: outcome.answer
        });
      }
      if (outcome.status === "unsupported-intent") {
        return privateResponse(reply)
          .code(422)
          .send({ message: "Tento AI záměr zatím není podporován" });
      }
      if (outcome.status === "invalid-request") {
        return privateResponse(reply).code(400).send({ message: "Neplatný AI požadavek" });
      }
      if (outcome.status === "policy-denied") {
        return privateResponse(reply).code(403).send({ message: "AI požadavek není povolen" });
      }
      if (outcome.status === "conversation-unavailable") {
        return privateResponse(reply)
          .code(409)
          .send({ message: "Konverzace se mezitím změnila nebo není dostupná" });
      }
      const statusCode =
        outcome.toolStatus === "policy-denied"
          ? 403
          : outcome.toolStatus === "rate-limited"
            ? 429
            : outcome.toolStatus === "timeout"
              ? 504
              : outcome.toolStatus === "invalid-input"
                ? 400
                : 502;
      return privateResponse(reply)
        .code(statusCode)
        .send({ message: "AI nástroj požadavek nedokončil" });
    }
  );

  app.post<{
    Body: {
      prompt: string;
      plan: PlanDocumentV2;
      externalModelConsent: boolean;
    };
  }>(
    "/v2/ai/plan-discuss",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: REJECT_UNKNOWN_PROPERTY,
          required: ["prompt", "plan", "externalModelConsent"],
          properties: {
            prompt: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" },
            plan: { type: "object", minProperties: 1, maxProperties: 32 },
            externalModelConsent: { const: true }
          }
        }
      },
      bodyLimit: 4 * 1024 * 1024,
      preHandler: rateLimitByIp(limiter, {
        bucket: "ai-plan-discussion",
        limit: dependencies.rateLimit ?? 20,
        windowMs: dependencies.rateLimitWindowMs ?? 60_000
      })
    },
    async (request, reply) => {
      const ownerUserId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!ownerUserId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }
      if (!dependencies.discussPlan) {
        return privateResponse(reply).code(503).send({ message: "AI diskuse není dostupná" });
      }
      try {
        assertPlanDocumentV2(request.body.plan);
      } catch {
        return privateResponse(reply).code(400).send({ message: "Neplatný formát plánu" });
      }
      if (request.body.plan.ownerId && request.body.plan.ownerId !== ownerUserId) {
        return privateResponse(reply).code(404).send({ message: "Plán nebyl nalezen" });
      }
      const answer = await dependencies.discussPlan({
        ownerUserId,
        plan: request.body.plan,
        prompt: request.body.prompt,
        externalModelConsent: request.body.externalModelConsent
      });
      if (!answer) {
        return privateResponse(reply)
          .code(503)
          .send({ message: "AI odpověď se nepodařilo připravit" });
      }
      return privateResponse(reply).send({ status: "succeeded", answer });
    }
  );

  app.get<{ Params: { planId: string } }>(
    "/v2/ai/plans/:planId/discussion",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: REJECT_UNKNOWN_PROPERTY,
          required: ["planId"],
          properties: { planId: identifierSchema }
        }
      }
    },
    async (request, reply) => {
      const ownerUserId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!ownerUserId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }
      if (!dependencies.planRepository || !dependencies.planDiscussionRepository) {
        return privateResponse(reply).code(503).send({ message: "AI diskuse není dostupná" });
      }
      const plan = await dependencies.planRepository.get(ownerUserId, request.params.planId);
      if (!plan) {
        return privateResponse(reply).code(404).send({ message: "Plán nebyl nalezen" });
      }
      const conversation = await dependencies.planDiscussionRepository.latest(ownerUserId, plan.id);
      return privateResponse(reply).send({ conversation });
    }
  );

  app.post<{
    Params: { planId: string };
    Body: {
      prompt: string;
      externalModelConsent: true;
      conversationId?: string;
      baseRevision?: number;
    };
  }>(
    "/v2/ai/plans/:planId/discussion",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: REJECT_UNKNOWN_PROPERTY,
          required: ["planId"],
          properties: { planId: identifierSchema }
        },
        body: {
          type: "object",
          additionalProperties: REJECT_UNKNOWN_PROPERTY,
          required: ["prompt", "externalModelConsent"],
          properties: {
            prompt: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" },
            externalModelConsent: { const: true },
            conversationId: identifierSchema,
            baseRevision: { type: "integer", minimum: 0, maximum: 1_000_000 }
          }
        }
      },
      bodyLimit: 16 * 1024,
      preHandler: rateLimitByIp(limiter, {
        bucket: "ai-plan-thread",
        limit: dependencies.rateLimit ?? 20,
        windowMs: dependencies.rateLimitWindowMs ?? 60_000
      })
    },
    async (request, reply) => {
      const ownerUserId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!ownerUserId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }
      if (
        !dependencies.discussPlan ||
        !dependencies.planRepository ||
        !dependencies.planDiscussionRepository
      ) {
        return privateResponse(reply).code(503).send({ message: "AI diskuse není dostupná" });
      }
      if (
        (request.body.conversationId === undefined) !==
        (request.body.baseRevision === undefined)
      ) {
        return privateResponse(reply)
          .code(400)
          .send({ message: "Konverzace vyžaduje ID i aktuální revizi" });
      }
      const plan = await dependencies.planRepository.get(ownerUserId, request.params.planId);
      if (!plan) {
        return privateResponse(reply).code(404).send({ message: "Plán nebyl nalezen" });
      }
      const current = request.body.conversationId
        ? await dependencies.planDiscussionRepository.get(
            ownerUserId,
            plan.id,
            request.body.conversationId
          )
        : null;
      if (request.body.conversationId && !current) {
        return privateResponse(reply).code(404).send({ message: "AI konverzace nebyla nalezena" });
      }
      if (current && current.revision !== request.body.baseRevision) {
        return privateResponse(reply)
          .code(409)
          .send({ message: "AI konverzace se mezitím změnila" });
      }
      const answer = await dependencies.discussPlan({
        ownerUserId,
        plan,
        prompt: request.body.prompt,
        externalModelConsent: request.body.externalModelConsent,
        history: current?.messages.map(({ role, content }) => ({ role, content })) ?? []
      });
      if (!answer) {
        return privateResponse(reply)
          .code(503)
          .send({ message: "AI odpověď se nepodařilo připravit" });
      }
      try {
        const conversation = await dependencies.planDiscussionRepository.appendExchange(
          ownerUserId,
          plan.id,
          {
            ...(current ? { conversationId: current.id, baseRevision: current.revision } : {}),
            prompt: request.body.prompt.trim(),
            answer: answer.text,
            model: answer.model,
            disclosure: answer.disclosure
          }
        );
        return privateResponse(reply).send({ status: "succeeded", conversation, answer });
      } catch (error) {
        return privateResponse(reply)
          .code(statusForClient(error))
          .send({ message: messageForClient(error, "AI konverzaci nelze uložit") });
      }
    }
  );
}
