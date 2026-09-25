import { isConversationWorkspaceData } from "@mapos/layer-sdk";
import type { MapArtifactRepository } from "../services/ai/mapArtifacts.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ChatHistoryRepository } from "../services/ai/chatHistory.js";
export function registerChatHistoryRoutes(
  app: FastifyInstance,
  repository: ChatHistoryRepository,
  resolveUser: (r: FastifyRequest) => string | null | Promise<string | null>,
  artifacts?: MapArtifactRepository
) {
  app.get<{ Params: { id: string } }>("/v2/ai/artifacts/:id", async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const owner = await resolveUser(req);
    if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno" });
    const artifact = await artifacts?.get(owner, req.params.id);
    if (!artifact || !(await repository.get(owner, artifact.conversationId)))
      return reply.code(404).send({ message: "Výsledek nebyl nalezen" });
    return artifact;
  });
  app.get<{ Querystring: { cursor?: string; archived?: string } }>(
    "/v2/ai/conversations",
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = await resolveUser(req);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno" });
      const offset = Number(req.query.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        return reply.code(400).send({ message: "Neplatný kurzor" });
      const rows = await repository.list(owner, offset, req.query.archived === "1");
      return {
        conversations: rows.map(({ id, title, revision, updatedAt, archived }) => ({
          id,
          title,
          revision,
          updatedAt,
          archived
        })),
        nextCursor: rows.length === 30 ? String(offset + 30) : null
      };
    }
  );
  app.get<{ Params: { id: string } }>("/v2/ai/conversations/:id", async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const owner = await resolveUser(req);
    if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno" });
    const row = await repository.get(owner, req.params.id);
    if (!row) return reply.code(404).send({ message: "Konverzace nebyla nalezena" });
    const { owner: _, ...document } = row;
    return document;
  });
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      archived?: boolean;
      workspace?: Record<string, unknown> | null;
      baseRevision?: number;
    };
  }>(
    "/v2/ai/conversations/:id",
    {
      bodyLimit: 1024 * 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            baseRevision: { type: "integer", minimum: 0 },
            title: { type: "string", minLength: 1, maxLength: 120 },
            archived: { type: "boolean" },
            workspace: { anyOf: [{ type: "object" }, { type: "null" }] }
          }
        }
      }
    },
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = await resolveUser(req);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno" });
      if (req.body.workspace != null && !isConversationWorkspaceData(req.body.workspace))
        return reply.code(400).send({ message: "Neplatný mapový pohled" });
      if (Array.isArray(req.body.workspace?.artifactIds)) {
        for (const id of req.body.workspace.artifactIds) {
          const artifact = await artifacts?.get(owner, String(id));
          if (!artifact || artifact.conversationId !== req.params.id)
            return reply.code(400).send({ message: "Mapový výsledek nepatří do této konverzace" });
        }
      }
      if (Object.hasOwn(req.body, "workspace") && req.body.baseRevision === undefined)
        return reply.code(400).send({ message: "Chybí revize mapového pohledu" });
      if (!(await repository.get(owner, req.params.id)))
        return reply.code(404).send({ message: "Konverzace nebyla nalezena" });
      if (!(await repository.patch(owner, req.params.id, req.body)))
        return reply.code(409).send({ message: "Konverzace se mezitím změnila" });
      return { ok: true };
    }
  );
  app.delete<{ Params: { id: string } }>("/v2/ai/conversations/:id", async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const owner = await resolveUser(req);
    if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno" });
    if (!(await repository.delete(owner, req.params.id)))
      return reply.code(404).send({ message: "Konverzace nebyla nalezena" });
    return { ok: true };
  });
}
