import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSavedPlaceInput,
  SavedPlaceListInput,
  SavedPlaceService,
  UpdateSavedPlaceInput
} from "../services/savedPlaceService.js";

// Fastify's default AJV configuration removes properties when this is the boolean `false`.
// An always-failing schema keeps request validation strict instead of silently normalizing input.
const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;

const NULLABLE_SHORT_TEXT = {
  anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }]
} as const;

const SOURCE_REF_SCHEMA = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["source", "sourceRef"],
  properties: {
    source: { type: "string", minLength: 1, maxLength: 40, pattern: "\\S" },
    sourceRef: { type: "string", minLength: 1, maxLength: 220, pattern: "\\S" }
  }
} as const;

const SNAPSHOT_SCHEMA = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["title", "position"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 180, pattern: "\\S" },
    position: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" }
    },
    category: NULLABLE_SHORT_TEXT,
    description: {
      anyOf: [{ type: "string", maxLength: 2_000 }, { type: "null" }]
    },
    sourceRefs: {
      type: "array",
      maxItems: 12,
      uniqueItems: true,
      items: SOURCE_REF_SCHEMA
    },
    attribution: {
      anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }]
    },
    capturedAt: { type: "string", format: "date-time" }
  }
} as const;

const TARGET_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: REJECT_UNKNOWN_PROPERTY,
      required: ["type", "canonicalPlaceId"],
      properties: {
        type: { const: "canonical-place" },
        canonicalPlaceId: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" }
      }
    },
    {
      type: "object",
      additionalProperties: REJECT_UNKNOWN_PROPERTY,
      required: ["type", "userPinId"],
      properties: {
        type: { const: "user-pin" },
        userPinId: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" }
      }
    },
    {
      type: "object",
      additionalProperties: REJECT_UNKNOWN_PROPERTY,
      required: ["type", "externalFeatureRef"],
      properties: {
        type: { const: "external-feature" },
        externalFeatureRef: { type: "string", minLength: 1, maxLength: 320, pattern: "\\S" }
      }
    },
    {
      type: "object",
      additionalProperties: REJECT_UNKNOWN_PROPERTY,
      required: ["type"],
      properties: { type: { const: "embedded-snapshot" } }
    }
  ]
} as const;

const PERSONAL_FIELDS = {
  snapshot: SNAPSHOT_SCHEMA,
  category: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" },
  note: { anyOf: [{ type: "string", maxLength: 4_000 }, { type: "null" }] },
  tags: {
    type: "array",
    maxItems: 24,
    uniqueItems: true,
    items: { type: "string", minLength: 1, maxLength: 40, pattern: "\\S" }
  },
  collectionId: {
    anyOf: [{ type: "string", minLength: 1, maxLength: 128, pattern: "\\S" }, { type: "null" }]
  },
  sortOrder: { type: "integer", minimum: -1_000_000_000, maximum: 1_000_000_000 }
} as const;

export const SAVED_PLACE_LIST_SCHEMA = {
  querystring: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    properties: {
      cursor: { type: "string", minLength: 1, maxLength: 512 },
      q: { type: "string", maxLength: 120 },
      category: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" },
      collection: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" },
      // Values above the public budget are accepted and clamped by the domain service to 100.
      limit: { type: "integer", minimum: 1 }
    }
  }
} as const;

export const SAVED_PLACE_CREATE_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["target", "snapshot"],
    properties: { target: TARGET_SCHEMA, ...PERSONAL_FIELDS }
  }
} as const;

export const SAVED_PLACE_UPDATE_SCHEMA = {
  params: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["id"],
    properties: { id: { type: "string", minLength: 1, maxLength: 128 } }
  },
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    minProperties: 1,
    properties: PERSONAL_FIELDS
  }
} as const;

const ID_PARAMS_SCHEMA = {
  params: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["id"],
    properties: { id: { type: "string", minLength: 1, maxLength: 128 } }
  }
} as const;

const COLLECTION_FIELDS = {
  name: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
  icon: { anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }] },
  color: {
    anyOf: [{ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, { type: "null" }]
  },
  visibility: { enum: ["private", "unlisted", "public"] }
} as const;

export const SAVED_PLACE_COLLECTION_CREATE_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    required: ["name"],
    properties: COLLECTION_FIELDS
  }
} as const;

export const SAVED_PLACE_COLLECTION_UPDATE_SCHEMA = {
  ...ID_PARAMS_SCHEMA,
  body: {
    type: "object",
    additionalProperties: REJECT_UNKNOWN_PROPERTY,
    minProperties: 1,
    properties: COLLECTION_FIELDS
  }
} as const;

export interface SavedPlaceRouteDependencies {
  service: SavedPlaceService;
  resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
}

async function ownerId(
  dependencies: SavedPlaceRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const userId = await dependencies.resolveUserId(request);
  if (userId) return userId;
  await reply.code(401).send({ message: "Unauthorized" });
  return null;
}

function personal(reply: FastifyReply) {
  return reply.header("cache-control", "private, no-store");
}

/** Same registrar is composed into production and memory servers; only repositories differ. */
export function registerSavedPlaceRoutes(
  app: FastifyInstance,
  dependencies: SavedPlaceRouteDependencies
) {
  app.get<{ Querystring: SavedPlaceListInput }>(
    "/v2/me/saved-places",
    { schema: SAVED_PLACE_LIST_SCHEMA },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      return personal(reply).send(await dependencies.service.list(userId, request.query));
    }
  );

  app.post<{ Body: CreateSavedPlaceInput }>(
    "/v2/me/saved-places",
    { schema: SAVED_PLACE_CREATE_SCHEMA, bodyLimit: 32 * 1024 },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const savedPlace = await dependencies.service.create(userId, request.body);
      return personal(reply).code(201).send({ savedPlace });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/v2/me/saved-places/:id",
    { schema: ID_PARAMS_SCHEMA },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const savedPlace = await dependencies.service.get(userId, request.params.id);
      return personal(reply).send({ savedPlace });
    }
  );

  app.patch<{ Params: { id: string }; Body: UpdateSavedPlaceInput }>(
    "/v2/me/saved-places/:id",
    { schema: SAVED_PLACE_UPDATE_SCHEMA, bodyLimit: 32 * 1024 },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const savedPlace = await dependencies.service.update(userId, request.params.id, request.body);
      return personal(reply).send({ savedPlace });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/v2/me/saved-places/:id",
    { schema: ID_PARAMS_SCHEMA },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      await dependencies.service.delete(userId, request.params.id);
      return personal(reply).code(204).send();
    }
  );

  app.get("/v2/me/saved-place-collections", async (request, reply) => {
    const userId = await ownerId(dependencies, request, reply);
    if (!userId) return;
    return personal(reply).send({
      collections: await dependencies.service.listCollections(userId)
    });
  });

  app.post<{
    Body: { name: string; icon?: string | null; color?: string | null; visibility?: string };
  }>(
    "/v2/me/saved-place-collections",
    { schema: SAVED_PLACE_COLLECTION_CREATE_SCHEMA, bodyLimit: 8 * 1024 },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const collection = await dependencies.service.createCollection(userId, request.body);
      return personal(reply).code(201).send({ collection });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/v2/me/saved-place-collections/:id",
    { schema: ID_PARAMS_SCHEMA },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const collection = await dependencies.service.getCollection(userId, request.params.id);
      return personal(reply).send({ collection });
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; icon?: string | null; color?: string | null; visibility?: string };
  }>(
    "/v2/me/saved-place-collections/:id",
    { schema: SAVED_PLACE_COLLECTION_UPDATE_SCHEMA, bodyLimit: 8 * 1024 },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      const collection = await dependencies.service.updateCollection(
        userId,
        request.params.id,
        request.body
      );
      return personal(reply).send({ collection });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/v2/me/saved-place-collections/:id",
    { schema: ID_PARAMS_SCHEMA },
    async (request, reply) => {
      const userId = await ownerId(dependencies, request, reply);
      if (!userId) return;
      await dependencies.service.deleteCollection(userId, request.params.id);
      return personal(reply).code(204).send();
    }
  );
}
