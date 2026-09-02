import type { EntitlementGrantV2, EntitlementV2 } from "@mapos/layer-sdk";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CommerceError, type CommerceService } from "../services/commerce/commerceService.js";

const PRODUCT_TYPES = [
  "layer",
  "layer-bundle",
  "subscription",
  "content",
  "feature",
  "world"
] as const;
const GRANTS = [
  "view",
  "query",
  "detail",
  "comment",
  "review",
  "export",
  "collaborate",
  "commercial-use"
] as const;

const EMPTY_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

const EMPTY_PARAMS = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

export interface CommerceRouteDependencies {
  service: CommerceService;
  resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
}

async function authenticated(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: CommerceRouteDependencies
): Promise<string | null> {
  const userId = await dependencies.resolveUserId(request);
  if (!userId) await reply.code(401).send({ message: "Unauthorized" });
  return userId;
}

async function sendCommerceError(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof CommerceError) {
    await reply.code(error.statusCode).send({ message: error.message, code: error.code });
    return;
  }
  throw error;
}

/** Shared registrar: production and memory differ only by repository/provider adapters. */
export function registerCommerceRoutes(
  app: FastifyInstance,
  dependencies: CommerceRouteDependencies
): void {
  app.get(
    "/v2/commerce/catalog",
    { schema: { querystring: EMPTY_QUERY, params: EMPTY_PARAMS } },
    async (request) => ({
      capability: dependencies.service.providerCapability(),
      products: await dependencies.service.catalog(await dependencies.resolveUserId(request))
    })
  );

  app.get(
    "/v2/me/entitlements",
    { schema: { querystring: EMPTY_QUERY, params: EMPTY_PARAMS } },
    async (request, reply) => {
      const userId = await authenticated(request, reply, dependencies);
      if (!userId) return;
      return { entitlements: await dependencies.service.listEntitlements(userId) };
    }
  );

  app.get(
    "/v2/commerce/access/:productType/:productId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["productType", "productId"],
          properties: {
            productType: { enum: PRODUCT_TYPES },
            productId: { type: "string", minLength: 1, maxLength: 200 }
          }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { grant: { enum: GRANTS, default: "view" } }
        }
      }
    },
    async (request, reply) => {
      const userId = await authenticated(request, reply, dependencies);
      if (!userId) return;
      const params = request.params as {
        productType: EntitlementV2["product"]["type"];
        productId: string;
      };
      const { grant = "view" } = request.query as { grant?: EntitlementGrantV2 };
      return {
        allowed: await dependencies.service.hasEntitlement(
          userId,
          params.productType,
          params.productId,
          grant
        )
      };
    }
  );

  app.post(
    "/v2/commerce/checkout",
    {
      bodyLimit: 8 * 1024,
      schema: {
        params: EMPTY_PARAMS,
        querystring: EMPTY_QUERY,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["offerId", "idempotencyKey"],
          properties: {
            offerId: { type: "string", minLength: 1, maxLength: 200 },
            idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{8,200}$" },
            referralId: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const userId = await authenticated(request, reply, dependencies);
      if (!userId) return;
      try {
        const result = await dependencies.service.createCheckout(
          userId,
          request.body as { offerId: string; idempotencyKey: string; referralId?: string | null }
        );
        return reply.code(202).send(result);
      } catch (error) {
        return sendCommerceError(reply, error);
      }
    }
  );

  app.post(
    "/v2/commerce/referrals",
    {
      bodyLimit: 8 * 1024,
      schema: {
        params: EMPTY_PARAMS,
        querystring: EMPTY_QUERY,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["campaign", "partnerId", "source", "consent"],
          properties: {
            campaign: { type: "string", minLength: 1, maxLength: 120 },
            partnerId: { type: "string", minLength: 1, maxLength: 160 },
            source: { type: "string", minLength: 1, maxLength: 160 },
            consent: { const: true }
          }
        }
      }
    },
    async (request, reply) => {
      const userId = await authenticated(request, reply, dependencies);
      if (!userId) return;
      try {
        return reply.code(201).send({
          referral: await dependencies.service.recordReferral(
            userId,
            request.body as {
              campaign: string;
              partnerId: string;
              source: string;
              consent: true;
            }
          )
        });
      } catch (error) {
        return sendCommerceError(reply, error);
      }
    }
  );

  app.post(
    "/v2/commerce/tips",
    {
      bodyLimit: 8 * 1024,
      schema: {
        params: EMPTY_PARAMS,
        querystring: EMPTY_QUERY,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipientType", "recipientId", "amountMinor", "currency", "idempotencyKey"],
          properties: {
            recipientType: {
              enum: ["layer-publisher", "poi-contributor", "project", "community-organization"]
            },
            recipientId: { type: "string", minLength: 1, maxLength: 200 },
            amountMinor: { type: "integer", minimum: 1, maximum: 1000000000 },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{8,200}$" }
          }
        }
      }
    },
    async (request, reply) => {
      const userId = await authenticated(request, reply, dependencies);
      if (!userId) return;
      try {
        return reply.code(202).send({
          ...(await dependencies.service.createTip(
            userId,
            request.body as Parameters<CommerceService["createTip"]>[1]
          ))
        });
      } catch (error) {
        return sendCommerceError(reply, error);
      }
    }
  );

  app.post(
    "/v2/commerce/webhooks/:provider",
    {
      bodyLimit: 128 * 1024,
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["provider"],
          properties: { provider: { const: "synthetic" } }
        },
        querystring: EMPTY_QUERY,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "occurredAt", "data"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 200 },
            type: {
              enum: [
                "order.paid",
                "order.cancelled",
                "order.refunded",
                "subscription.active",
                "subscription.past_due",
                "subscription.cancel_at_period_end",
                "subscription.cancelled",
                "subscription.expired",
                "subscription.refunded",
                "tip.paid",
                "tip.refunded"
              ]
            },
            occurredAt: { type: "string", format: "date-time" },
            data: {
              type: "object",
              additionalProperties: false,
              properties: {
                orderId: { type: "string", minLength: 1, maxLength: 200 },
                subscriptionId: { type: "string", minLength: 1, maxLength: 200 },
                tipId: { type: "string", minLength: 1, maxLength: 200 },
                periodStart: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                periodEnd: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                graceEndsAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const provider = (request.params as { provider: string }).provider;
      const signatureHeader = request.headers["x-mapos-signature"];
      const signature = Array.isArray(signatureHeader) ? undefined : signatureHeader;
      if (signature && signature.length > 128) {
        return reply.code(400).send({ message: "Invalid signature header" });
      }
      try {
        return await dependencies.service.processWebhook(provider, request.body, signature);
      } catch (error) {
        return sendCommerceError(reply, error);
      }
    }
  );
}
