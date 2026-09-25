import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DataRightsNotFoundError, type DataRightsService } from "../services/dataRightsService.js";

// Fastify's AJV defaults remove properties for boolean `false`; an always-failing schema makes
// unknown input a 400 instead of silently turning a destructive request into a valid one.
const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;

const EMPTY_OBJECT = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  properties: {}
} as const;

const DELETE_ACCOUNT_SCHEMA = {
  params: EMPTY_OBJECT,
  querystring: EMPTY_OBJECT,
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["confirmation"],
    properties: { confirmation: { const: "DELETE MY ACCOUNT" } }
  }
} as const;

export interface DataRightsRouteDependencies {
  service: DataRightsService;
  resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
  clearSession(reply: FastifyReply): void;
  eraseWorld?(userId: string): Promise<void>;
  exportWorld?(userId: string): Promise<unknown>;
}

function privateNoStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "private, no-store");
  reply.header("Pragma", "no-cache");
}

async function owner(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: DataRightsRouteDependencies
): Promise<string | null> {
  const userId = await dependencies.resolveUserId(request);
  if (!userId) await reply.code(401).send({ message: "Unauthorized" });
  return userId;
}

function notFound(reply: FastifyReply, error: unknown): void {
  if (error instanceof DataRightsNotFoundError) {
    void reply.code(404).send({ message: error.message });
    return;
  }
  throw error;
}

/** The same owner-scoped registrar is composed into production and deterministic memory mode. */
export function registerDataRightsRoutes(
  app: FastifyInstance,
  dependencies: DataRightsRouteDependencies
): void {
  app.get(
    "/v2/me/export",
    { schema: { params: EMPTY_OBJECT, querystring: EMPTY_OBJECT } },
    async (request, reply) => {
      privateNoStore(reply);
      const userId = await owner(request, reply, dependencies);
      if (!userId) return;
      try {
        const exported = await dependencies.service.exportAccount(userId);
        reply.header("Content-Disposition", 'attachment; filename="mapos-account-export.json"');
        return dependencies.exportWorld
          ? { ...exported, world: await dependencies.exportWorld(userId) }
          : exported;
      } catch (error) {
        return notFound(reply, error);
      }
    }
  );

  app.delete(
    "/v2/me",
    { schema: DELETE_ACCOUNT_SCHEMA, bodyLimit: 1024 },
    async (request, reply) => {
      privateNoStore(reply);
      const userId = await owner(request, reply, dependencies);
      if (!userId) return;
      try {
        await dependencies.eraseWorld?.(userId);
        const result = await dependencies.service.deleteAccount(userId);
        dependencies.clearSession(reply);
        return result;
      } catch (error) {
        return notFound(reply, error);
      }
    }
  );
}
