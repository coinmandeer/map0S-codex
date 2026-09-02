import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Bbox, FeatureQueryV2, LayerImportVisibilityV2 } from "@mapos/layer-sdk";
import { ClientError, messageForClient, statusForClient } from "../utils/clientError.js";
import type { DeclarativeHttpLayerService } from "../services/declarativeHttpLayerService.js";
import type { LayerImportService } from "../services/layerImportService.js";

const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const ID_PARAMS = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["id"],
  properties: { id: { type: "string", pattern: UUID_PATTERN } }
} as const;

export const LAYER_SOURCE_FEATURES_SCHEMA = {
  params: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["layerId"],
    properties: { layerId: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{1,99}$" } }
  },
  querystring: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["bbox"],
    properties: {
      bbox: { type: "string", minLength: 7, maxLength: 100 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", minLength: 1, maxLength: 512 },
      zoom: { type: "number", minimum: 0, maximum: 24 },
      filters: { type: "string", maxLength: 2_000 }
    }
  }
} as const;

export const LAYER_IMPORT_PREVIEW_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["filename"],
    properties: {
      filename: { type: "string", minLength: 1, maxLength: 240 },
      content: { type: "string", maxLength: 5 * 1024 * 1024 },
      document: {}
    },
    oneOf: [
      { required: ["content"], not: { required: ["document"] } },
      { required: ["document"], not: { required: ["content"] } }
    ]
  }
} as const;

export const LAYER_IMPORT_COMMIT_SCHEMA = {
  params: ID_PARAMS,
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    properties: { visibility: { enum: ["private", "public"] } }
  }
} as const;

export const LAYER_IMPORT_ROLLBACK_SCHEMA = { params: ID_PARAMS } as const;

export interface LayerExtensionRouteDependencies {
  importService: Pick<LayerImportService, "preview" | "commit" | "rollback">;
  sourceService: Pick<DeclarativeHttpLayerService, "features">;
  resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
}

function bbox(value: string): Bbox {
  const values = value.split(",").map(Number);
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
    throw new ClientError("bbox must be west,south,east,north", 400);
  }
  return values as Bbox;
}

function filters(value: string | undefined): FeatureQueryV2["filters"] {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ClientError("filters must be a JSON object", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ClientError("filters must be a JSON object", 400);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 24 || entries.some(([key]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))) {
    throw new ClientError("filters contain unsupported keys", 400);
  }
  for (const [, entry] of entries) {
    if (
      !["string", "number", "boolean"].includes(typeof entry) &&
      !(
        Array.isArray(entry) &&
        entry.length <= 20 &&
        entry.every((item) => ["string", "number", "boolean"].includes(typeof item))
      )
    ) {
      throw new ClientError("filters contain unsupported values", 400);
    }
  }
  return parsed as FeatureQueryV2["filters"];
}

async function owner(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: LayerExtensionRouteDependencies
): Promise<string | null> {
  const userId = await dependencies.resolveUserId(request);
  if (!userId) {
    await reply.code(401).send({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function failure(reply: FastifyReply, error: unknown, fallback: string) {
  return reply.code(statusForClient(error)).send({ message: messageForClient(error, fallback) });
}

/** Shared registrar: production and memory differ only by injected repositories/source registry. */
export function registerLayerExtensionRoutes(
  app: FastifyInstance,
  dependencies: LayerExtensionRouteDependencies
): void {
  app.get<{
    Params: { layerId: string };
    Querystring: { bbox: string; limit?: number; cursor?: string; zoom?: number; filters?: string };
  }>(
    "/v2/layer-sources/:layerId/features",
    { schema: LAYER_SOURCE_FEATURES_SCHEMA },
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      try {
        const result = await dependencies.sourceService.features(
          request.params.layerId,
          {
            bbox: bbox(request.query.bbox),
            limit: request.query.limit,
            cursor: request.query.cursor,
            zoom: request.query.zoom,
            filters: filters(request.query.filters)
          },
          controller.signal
        );
        return reply.header("cache-control", "private, no-store").send(result);
      } catch (error) {
        return failure(reply, error, "Layer source is temporarily unavailable");
      } finally {
        request.raw.removeListener("aborted", abort);
        reply.raw.removeListener("close", abort);
      }
    }
  );

  app.post<{ Body: { filename: string; content?: string; document?: unknown } }>(
    "/v2/layer-imports/preview",
    { schema: LAYER_IMPORT_PREVIEW_SCHEMA, bodyLimit: 6 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await owner(request, reply, dependencies);
      if (!userId) return;
      try {
        return reply
          .header("cache-control", "private, no-store")
          .send(await dependencies.importService.preview(userId, request.body));
      } catch (error) {
        return failure(reply, error, "Layer import preview failed");
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { visibility?: LayerImportVisibilityV2 } }>(
    "/v2/layer-imports/:id/commit",
    { schema: LAYER_IMPORT_COMMIT_SCHEMA },
    async (request, reply) => {
      const userId = await owner(request, reply, dependencies);
      if (!userId) return;
      try {
        return reply.header("cache-control", "private, no-store").send({
          report: await dependencies.importService.commit(
            userId,
            request.params.id,
            request.body.visibility
          )
        });
      } catch (error) {
        return failure(reply, error, "Layer import commit failed");
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v2/layer-imports/:id/rollback",
    { schema: LAYER_IMPORT_ROLLBACK_SCHEMA },
    async (request, reply) => {
      const userId = await owner(request, reply, dependencies);
      if (!userId) return;
      try {
        return reply.header("cache-control", "private, no-store").send({
          report: await dependencies.importService.rollback(userId, request.params.id)
        });
      } catch (error) {
        return failure(reply, error, "Layer import rollback failed");
      }
    }
  );
}
