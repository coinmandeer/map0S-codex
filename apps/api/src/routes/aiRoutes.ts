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
import type { AiChatTurnFactory } from "../services/ai/chatComposition.js";
import type { AiChatEvent } from "../services/ai/chatService.js";
import {
  AiPlanProposalNotFoundError,
  AiPlanProposalPlanMissingError,
  AiPlanProposalRevisionError,
  AiPlanProposalStateError,
  type AiPlanProposalCoordinator
} from "../services/ai/planEditor.js";
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

/** `POST /v2/ai/chat` (§30.3). The body is the map as the browser sees it plus the two consents;
 *  everything the server acts on is re-derived from it against the projection. */
export const AI_CHAT_ROUTE_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["message", "context", "consent"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" },
      conversationId: identifierSchema,
      baseRevision: { type: "integer", minimum: 0, maximum: 1_000_000 },
      scope: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        required: ["type"],
        properties: { type: { type: "string", enum: ["global"] } }
      },
      context: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        required: ["mapCenter", "zoom", "activeLayerIds"],
        properties: {
          mapCenter: {
            type: "object",
            additionalProperties: REJECT_UNKNOWN_PROPERTY,
            required: ["longitude", "latitude"],
            properties: {
              longitude: { type: "number", minimum: -180, maximum: 180 },
              latitude: { type: "number", minimum: -90, maximum: 90 }
            }
          },
          bbox: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "number", minimum: -180, maximum: 180 }
          },
          zoom: { type: "number", minimum: 0, maximum: 24 },
          activeLayerIds: {
            type: "array",
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
              tags: { type: "array", maxItems: 20, uniqueItems: true, items: identifierSchema }
            }
          },
          mode: { type: "string", minLength: 1, maxLength: 32 },
          planId: identifierSchema,
          featureRef: {
            type: "object",
            additionalProperties: REJECT_UNKNOWN_PROPERTY,
            required: ["layerId", "featureId"],
            properties: { layerId: identifierSchema, featureId: identifierSchema }
          },
          regionRef: { type: "string", minLength: 1, maxLength: 240 }
        }
      },
      consent: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        required: ["externalModel", "preciseLocation"],
        properties: {
          externalModel: { type: "boolean" },
          preciseLocation: { type: "boolean" },
          savedPlaces: { type: "boolean" }
        }
      }
    }
  }
} as const;

export interface AiChatRouteBody {
  message: string;
  conversationId?: string;
  baseRevision?: number;
  scope?: { type: "global" };
  context: {
    mapCenter: { longitude: number; latitude: number };
    bbox?: [number, number, number, number];
    zoom: number;
    activeLayerIds: string[];
    activeFilters?: { openNow?: boolean; minRating?: number; tags?: string[] };
    mode?: string;
    planId?: string;
    featureRef?: { layerId: string; featureId: string };
    regionRef?: string;
  };
  consent: { externalModel: boolean; preciseLocation: boolean; savedPlaces?: boolean };
}

export interface AiRouteDependencies {
  orchestrator: ProviderNeutralAiOrchestrator;
  resolveUserId(request: FastifyRequest): string | null | Promise<string | null>;
  allowedLayerIds: ReadonlySet<string>;
  rateLimiter?: RequestRateLimiter;
  rateLimit?: number;
  rateLimitWindowMs?: number;
  /** One chat service per turn; absent means the deployment exposes no assistant. */
  chatTurn?: AiChatTurnFactory;
  discussPlan?: (request: PlanDiscussionRequest) => Promise<PlanDiscussionAnswer | null>;
  planRepository?: PlanDocumentRepository;
  planDiscussionRepository?: PlanDiscussionRepository;
  /** Confirm/reject/undo for AI plan edits; absent means the chat can only talk about plans. */
  planProposals?: AiPlanProposalCoordinator;
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

  app.post<{ Body: AiChatRouteBody }>(
    "/v2/ai/chat",
    {
      schema: AI_CHAT_ROUTE_SCHEMA,
      bodyLimit: 32 * 1024,
      preHandler: rateLimitByIp(limiter, {
        bucket: "ai-chat",
        limit: dependencies.rateLimit ?? 20,
        windowMs: dependencies.rateLimitWindowMs ?? 60_000
      })
    },
    async (request, reply) => {
      const userId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!userId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }
      if (!dependencies.chatTurn) {
        return privateResponse(reply).code(503).send({ message: "Asistent není dostupný" });
      }
      if (
        (request.body.conversationId === undefined) !==
        (request.body.baseRevision === undefined)
      ) {
        return privateResponse(reply)
          .code(400)
          .send({ message: "Konverzace vyžaduje ID i aktuální revizi" });
      }

      const { context, consent } = request.body;
      const allowedLayerIds = context.activeLayerIds.filter((layerId) =>
        dependencies.allowedLayerIds.has(layerId)
      );
      const service = dependencies.chatTurn({
        center: context.mapCenter,
        zoom: context.zoom,
        activeLayerIds: allowedLayerIds
      });

      // Server-sent events: the tool steps are the interesting part of the wait, so they are
      // written as they happen rather than summarised after the answer is already there. The
      // reply is hijacked because Fastify must not also try to serialise a body.
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const write = (event: AiChatEvent) => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const abort = new AbortController();
      request.raw.on("close", () => abort.abort());

      try {
        await service.run(
          {
            ownerUserId: userId,
            message: request.body.message,
            messageDataClass: "account-private",
            context: {
              mapCenter: context.mapCenter,
              ...(context.bbox ? { bbox: context.bbox } : {}),
              zoom: context.zoom,
              activeLayerIds: allowedLayerIds,
              ...(context.activeFilters ? { activeFilters: context.activeFilters } : {}),
              ...(context.mode ? { mode: context.mode } : {}),
              ...(context.planId ? { planId: context.planId } : {}),
              ...(context.featureRef ? { featureRef: context.featureRef } : {}),
              ...(context.regionRef ? { regionRef: context.regionRef } : {})
            },
            consent: {
              externalModel: consent.externalModel === true,
              preciseLocation: consent.preciseLocation === true
            },
            conversation: request.body.conversationId
              ? {
                  mode: "existing",
                  conversationId: request.body.conversationId,
                  baseRevision: request.body.baseRevision!
                }
              : { mode: "new", scope: request.body.scope ?? { type: "global" } },
            actor: {
              authenticated: true,
              userId,
              permissions: new Set([
                "map:read",
                "layers:read",
                "poi:read",
                "route:read",
                "weather:read",
                "events:read",
                // The web tools send the question to an external service, so they exist only for
                // a user who agreed to that.
                ...(consent.externalModel ? ["web:read"] : []),
                ...(consent.savedPlaces ? ["saved-places:read"] : [])
              ]),
              entitlementIds: new Set()
            },
            projection: {
              allowedLayerIds: new Set(dependencies.allowedLayerIds),
              allowedPlanIds: new Set(context.planId ? [context.planId] : []),
              allowedFeatureFieldsByLayer: new Map(),
              allowedDataClasses: new Set(
                consent.savedPlaces ? ["public", "account-private"] : ["public"]
              ),
              allowPreciseLocation: consent.preciseLocation === true
            },
            signal: abort.signal
          },
          write
        );
      } catch {
        write({
          type: "error",
          code: "answer-unavailable",
          message: "Odpověď se teď nepodařilo připravit"
        });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
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

  /**
   * The confirmation boundary for an AI plan edit (§30.8).
   *
   * The chat only ever proposes; these three routes are the only way a proposal reaches the
   * stored plan, and each of them re-reads the plan first. A proposal made against revision 4
   * cannot be applied to revision 5 — the user sees "the plan changed" instead of a silent merge.
   */
  const proposalOptions = {
    schema: {
      params: {
        type: "object",
        additionalProperties: REJECT_UNKNOWN_PROPERTY,
        required: ["proposalId"],
        properties: { proposalId: identifierSchema }
      }
    },
    bodyLimit: 1024,
    preHandler: rateLimitByIp(limiter, {
      bucket: "ai-plan-proposal",
      limit: dependencies.rateLimit ?? 20,
      windowMs: dependencies.rateLimitWindowMs ?? 60_000
    })
  };

  const proposalHandler =
    (action: "confirm" | "reject" | "undo") =>
    async (request: FastifyRequest<{ Params: { proposalId: string } }>, reply: FastifyReply) => {
      const ownerUserId = (await dependencies.resolveUserId(request))?.trim() || null;
      if (!ownerUserId) {
        return privateResponse(reply).code(401).send({ message: "Přihlášení je vyžadováno" });
      }
      const coordinator = dependencies.planProposals;
      if (!coordinator) {
        return privateResponse(reply).code(503).send({ message: "AI návrhy nejsou dostupné" });
      }
      try {
        if (action === "reject") {
          const proposal = coordinator.reject(ownerUserId, request.params.proposalId);
          return privateResponse(reply).send({ status: "rejected", proposal });
        }
        const applied =
          action === "confirm"
            ? await coordinator.confirm(ownerUserId, request.params.proposalId)
            : await coordinator.undo(ownerUserId, request.params.proposalId);
        return privateResponse(reply).send({
          status: action === "confirm" ? "confirmed" : "undone",
          proposal: applied.proposal,
          plan: applied.plan
        });
      } catch (error) {
        return privateResponse(reply)
          .code(proposalStatus(error))
          .send({ message: proposalMessage(error) });
      }
    };

  app.post<{ Params: { proposalId: string } }>(
    "/v2/ai/plan-proposals/:proposalId/confirm",
    proposalOptions,
    proposalHandler("confirm")
  );
  app.post<{ Params: { proposalId: string } }>(
    "/v2/ai/plan-proposals/:proposalId/reject",
    proposalOptions,
    proposalHandler("reject")
  );
  app.post<{ Params: { proposalId: string } }>(
    "/v2/ai/plan-proposals/:proposalId/undo",
    proposalOptions,
    proposalHandler("undo")
  );
}

function proposalStatus(error: unknown): number {
  if (
    error instanceof AiPlanProposalNotFoundError ||
    error instanceof AiPlanProposalPlanMissingError
  ) {
    return 404;
  }
  if (
    error instanceof AiPlanProposalStateError ||
    error instanceof AiPlanProposalRevisionError
  ) {
    return 409;
  }
  return statusForClient(error);
}

function proposalMessage(error: unknown): string {
  if (error instanceof AiPlanProposalNotFoundError) return "Návrh nebyl nalezen";
  if (error instanceof AiPlanProposalPlanMissingError) return "Plán nebyl nalezen";
  if (error instanceof AiPlanProposalRevisionError) return "Plán se mezitím změnil";
  if (error instanceof AiPlanProposalStateError) return "Návrh už není otevřený";
  return messageForClient(error, "Návrh se nepodařilo použít");
}
