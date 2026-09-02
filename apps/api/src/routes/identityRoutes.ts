import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AavegotchiInventoryAdapter } from "../services/identity/aavegotchiInventory.js";
import type {
  WalletDisplayMetadata,
  WalletDisplayMetadataResolver
} from "../services/identity/ensDisplayResolver.js";
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityVerificationError,
  type IdentityLink,
  type LinkedIdentityService
} from "../services/identity/identityService.js";

export interface IdentityRouteSession {
  userId: string;
  sessionId: string;
}

export interface RotatedIdentitySession {
  sessionId: string;
  expiresAt: Date;
}

export interface IdentityRouteDependencies {
  service: LinkedIdentityService;
  resolveSession(request: FastifyRequest): Promise<IdentityRouteSession | null>;
  rotateSession(userId: string, previousSessionId: string): Promise<RotatedIdentitySession>;
  applySession(reply: FastifyReply, session: RotatedIdentitySession): void;
  inventoryFor(identity: IdentityLink): AavegotchiInventoryAdapter;
  displayMetadata?: WalletDisplayMetadataResolver;
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  maxProperties: 0,
  additionalProperties: false
} as const;

const CHALLENGE_SCHEMA = {
  params: EMPTY_OBJECT_SCHEMA,
  querystring: EMPTY_OBJECT_SCHEMA,
  body: {
    type: "object",
    // Fastify's default AJV may remove `additionalProperties: false` body fields. Keeping them
    // present and rejecting their names prevents an attacker-supplied domain from disappearing
    // before the handler's exact-key check.
    additionalProperties: true,
    maxProperties: 2,
    propertyNames: { enum: ["address", "chainId"] },
    required: ["address", "chainId"],
    properties: {
      address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      chainId: { type: "integer", minimum: 1, maximum: 2147483647 }
    }
  }
} as const;

const VERIFY_SCHEMA = {
  params: EMPTY_OBJECT_SCHEMA,
  querystring: EMPTY_OBJECT_SCHEMA,
  body: {
    type: "object",
    additionalProperties: true,
    maxProperties: 3,
    propertyNames: { enum: ["challengeId", "message", "signature"] },
    required: ["challengeId", "message", "signature"],
    properties: {
      challengeId: { type: "string", minLength: 1, maxLength: 160 },
      message: { type: "string", minLength: 1, maxLength: 16 * 1024 },
      signature: { type: "string", minLength: 3, maxLength: 4 * 1024, pattern: "^0x[0-9a-fA-F]+$" }
    }
  }
} as const;

const IDENTITY_ID_PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 160 } }
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "private, no-store");
}

function publicIdentity(
  identity: IdentityLink,
  displayMetadata: WalletDisplayMetadata | null = null
) {
  return {
    id: identity.id,
    type: identity.type,
    provider: identity.provider,
    subject: identity.subject,
    displayLabel: identity.displayLabel,
    simulated: identity.simulated,
    verifiedAt: identity.verifiedAt,
    revokedAt: identity.revokedAt,
    createdAt: identity.createdAt,
    displayMetadata
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof IdentityNotFoundError) {
    return reply.code(404).send({ message: error.message });
  }
  if (error instanceof IdentityConflictError) {
    return reply.code(409).send({ message: error.message });
  }
  if (error instanceof IdentityVerificationError || error instanceof TypeError) {
    return reply.code(400).send({ message: error.message });
  }
  return reply.code(500).send({ message: "Identity operation failed" });
}

async function authenticated(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: IdentityRouteDependencies
): Promise<IdentityRouteSession | null> {
  const session = await dependencies.resolveSession(request);
  if (!session) {
    await reply.code(401).send({ message: "Unauthorized" });
    return null;
  }
  return session;
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  dependencies: IdentityRouteDependencies
): void {
  app.post<{ Body: unknown }>(
    "/v2/auth/siwe/challenge",
    { schema: CHALLENGE_SCHEMA, bodyLimit: 4 * 1024 },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      if (
        !record(request.body) ||
        !exactKeys(request.body, ["address", "chainId"]) ||
        typeof request.body.address !== "string" ||
        !Number.isSafeInteger(request.body.chainId)
      ) {
        return reply.code(400).send({ message: "Invalid SIWE challenge request" });
      }
      try {
        const challenge = await dependencies.service.createChallenge({
          ...session,
          address: request.body.address,
          chainId: Number(request.body.chainId)
        });
        const {
          userId: _userId,
          sessionId: _sessionId,
          usedAt: _usedAt,
          ...publicChallenge
        } = challenge;
        return { challenge: publicChallenge };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/v2/auth/siwe/verify",
    { schema: VERIFY_SCHEMA, bodyLimit: 32 * 1024 },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      if (
        !record(request.body) ||
        !exactKeys(request.body, ["challengeId", "message", "signature"]) ||
        typeof request.body.challengeId !== "string" ||
        typeof request.body.message !== "string" ||
        typeof request.body.signature !== "string"
      ) {
        return reply.code(400).send({ message: "Invalid SIWE verification request" });
      }
      try {
        const identity = await dependencies.service.verifyAndLink({
          ...session,
          challengeId: request.body.challengeId,
          message: request.body.message,
          signature: request.body.signature
        });
        const rotated = await dependencies.rotateSession(session.userId, session.sessionId);
        dependencies.applySession(reply, rotated);
        return { identity: publicIdentity(identity), sessionRotated: true };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  app.get(
    "/v2/me/identities",
    { schema: { params: EMPTY_OBJECT_SCHEMA, querystring: EMPTY_OBJECT_SCHEMA } },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      try {
        return {
          identities: await Promise.all(
            (await dependencies.service.list(session.userId)).map(async (identity) =>
              publicIdentity(
                identity,
                (await dependencies.displayMetadata?.resolve(identity)) ?? null
              )
            )
          )
        };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/v2/me/identities/:id",
    {
      schema: { params: IDENTITY_ID_PARAMS_SCHEMA, querystring: EMPTY_OBJECT_SCHEMA }
    },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      try {
        return {
          identity: publicIdentity(
            await dependencies.service.revoke(session.userId, request.params.id)
          )
        };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/v2/auth/simulation/link",
    {
      schema: {
        params: EMPTY_OBJECT_SCHEMA,
        querystring: EMPTY_OBJECT_SCHEMA,
        body: {
          type: "object",
          additionalProperties: true,
          maxProperties: 1,
          propertyNames: { enum: ["label"] },
          properties: { label: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" } }
        }
      },
      bodyLimit: 2 * 1024
    },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      if (
        request.body !== undefined &&
        (!record(request.body) ||
          !exactKeys(request.body, ["label"]) ||
          (request.body.label !== undefined && typeof request.body.label !== "string"))
      ) {
        return reply.code(400).send({ message: "Invalid simulation identity request" });
      }
      try {
        const label = record(request.body) ? (request.body.label as string | undefined) : undefined;
        const identity = await dependencies.service.linkSimulation(session.userId, label);
        const rotated = await dependencies.rotateSession(session.userId, session.sessionId);
        dependencies.applySession(reply, rotated);
        return { identity: publicIdentity(identity), sessionRotated: true };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  app.get<{ Querystring: { identityId?: string } }>(
    "/v2/me/aavegotchi-inventory",
    {
      schema: {
        params: EMPTY_OBJECT_SCHEMA,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["identityId"],
          properties: { identityId: { type: "string", minLength: 1, maxLength: 160 } }
        }
      }
    },
    async (request, reply) => {
      noStore(reply);
      const session = await authenticated(request, reply, dependencies);
      if (!session) return;
      try {
        const identities = await dependencies.service.list(session.userId);
        const identity = identities.find(
          (candidate) => candidate.id === request.query.identityId && !candidate.revokedAt
        );
        if (!identity || (identity.type !== "wallet" && identity.type !== "simulated-wallet")) {
          throw new IdentityNotFoundError("Wallet identity not found");
        }
        return {
          inventory: await dependencies
            .inventoryFor(identity)
            .load(identity.subject, request.signal)
        };
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );
}
