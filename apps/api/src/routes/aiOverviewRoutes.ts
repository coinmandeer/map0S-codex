import type { OverviewSnapshotRepository } from "../services/ai/overviewSnapshots.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AreaSelection, OverviewRequest } from "@mapos/layer-sdk";
import { OverviewService } from "../services/ai/overviewService.js";
import { sourcePlaceDetail } from "../services/ai/sourceDetail.js";
import {
  overviewCollectors,
  overviewSynthesis,
  overviewSynthesisAvailable
} from "../services/ai/overviewProduction.js";
import { FixedWindowRateLimiter, rateLimitByIp } from "../security/publicApiHardening.js";
const text = { type: "string", minLength: 1, maxLength: 256 };
const closed = { not: {} };
const targetSchemas = [
  {
    type: "object",
    additionalProperties: closed,
    required: ["type", "layerId", "featureId"],
    properties: {
      type: { const: "poi" },
      layerId: text,
      featureId: text,
      lng: { type: "number", minimum: -180, maximum: 180 },
      lat: { type: "number", minimum: -90, maximum: 90 }
    }
  },
  {
    type: "object",
    additionalProperties: closed,
    required: ["type", "lng", "lat"],
    properties: {
      type: { const: "coordinate" },
      lng: { type: "number", minimum: -180, maximum: 180 },
      lat: { type: "number", minimum: -90, maximum: 90 }
    }
  },
  {
    type: "object",
    additionalProperties: closed,
    required: ["type", "areaId", "boundaryRevision"],
    properties: { type: { const: "area" }, areaId: text, boundaryRevision: text }
  },
  {
    type: "object",
    additionalProperties: closed,
    required: ["type", "bbox"],
    properties: {
      type: { const: "viewport" },
      bbox: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { type: "number", minimum: -180, maximum: 180 }
      }
    }
  }
];
export function registerAiOverviewRoutes(
  app: FastifyInstance,
  dependencies: {
    resolveUserId(request: FastifyRequest): Promise<string | null> | string | null;
    allowedLayerIds: ReadonlySet<string>;
    resolveArea?: (query: Record<string, string | undefined>) => Promise<AreaSelection | null>;
    overview?: OverviewService;
    overviewSnapshots?: OverviewSnapshotRepository;
  }
) {
  const service =
    dependencies.overview ??
    new OverviewService({
      detail: sourcePlaceDetail,
      area: (areaId, boundaryRevision) =>
        dependencies.resolveArea?.({ areaId, boundaryRevision }) ?? Promise.resolve(null),
      collect: overviewCollectors,
      synthesize: overviewSynthesis,
      synthesisAvailable: overviewSynthesisAvailable
    });
  app.post<{ Body: OverviewRequest }>(
    "/v2/ai/overview",
    {
      bodyLimit: 8192,
      preHandler: rateLimitByIp(new FixedWindowRateLimiter(), {
        bucket: "ai-overview",
        limit: 20,
        windowMs: 60000
      }),
      schema: {
        body: {
          type: "object",
          additionalProperties: closed,
          required: ["target", "consent"],
          properties: {
            target: { oneOf: targetSchemas },
            language: { type: "string", pattern: "^[a-z]{2}(-[A-Z]{2})?$" },
            intent: { type: "string", maxLength: 300 },
            worldId: text,
            web: { type: "boolean" },
            refresh: { type: "boolean" },
            // Bounded public pin fields. They add evidence; they never select a provider/source.
            facts: { type: "string", maxLength: 2048 },
            consent: {
              type: "object",
              additionalProperties: closed,
              required: ["externalModel"],
              properties: { externalModel: { type: "boolean" } }
            }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (process.env.MAPOS_AI_OVERVIEW_V2 === "0")
        return reply.code(503).send({ message: "AI přehled je dočasně vypnutý." });
      const owner = await dependencies.resolveUserId(request);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno." });
      const target = request.body.target;
      if (target.type === "poi" && !dependencies.allowedLayerIds.has(target.layerId))
        return reply.code(403).send({ message: "Vrstva cíle není dostupná." });
      if (
        target.type === "viewport" &&
        (Math.abs(target.bbox[1]) > 90 ||
          Math.abs(target.bbox[3]) > 90 ||
          target.bbox[1] >= target.bbox[3] ||
          target.bbox[0] === target.bbox[2])
      )
        return reply.code(400).send({ message: "Neplatný výřez." });
      if (target.type === "area") {
        const area = await dependencies
          .resolveArea?.({ areaId: target.areaId, boundaryRevision: target.boundaryRevision })
          .catch(() => null);
        if (!area)
          return reply.code(409).send({ message: "Oblast není dostupná. Obnovte její výběr." });
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform",
        "x-accel-buffering": "no"
      });
      const controller = new AbortController();
      const disconnect = () => controller.abort();
      reply.raw.once("close", disconnect);
      try {
        await service.run(
          request.body,
          {
            ownerUserId: owner,
            permissionRevision: "public-sources-v1",
            allowedLayerIds: dependencies.allowedLayerIds
          },
          controller.signal,
          (event) => {
            if (!reply.raw.destroyed && !reply.raw.writableEnded)
              reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        );
      } catch {
        // Missing terminal becomes a bounded partial result on the client, never an eternal loader.
      } finally {
        reply.raw.off("close", disconnect);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    }
  );
  app.post<{ Body: { fingerprint: string } }>(
    "/v2/ai/overview/snapshots",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: closed,
          required: ["fingerprint"],
          properties: { fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" } }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = await dependencies.resolveUserId(request);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno." });
      if (!dependencies.overviewSnapshots)
        return reply.code(503).send({ message: "Ukládání přehledů není dostupné." });
      const snapshot = service.getOwnedSnapshot(
        owner,
        request.body.fingerprint,
        dependencies.allowedLayerIds
      );
      if (!snapshot)
        return reply
          .code(409)
          .send({ message: "Přehled už není v aktuální cache. Nejprve ho obnovte." });
      if (snapshot.recipe.target.type === "area") {
        const target = snapshot.recipe.target;
        const area = await dependencies
          .resolveArea?.({ areaId: target.areaId, boundaryRevision: target.boundaryRevision })
          .catch(() => null);
        if (!area) return reply.code(409).send({ message: "Vydání oblasti již není dostupné." });
      }
      return {
        id: await dependencies.overviewSnapshots.save(owner, snapshot.recipe, snapshot.result)
      };
    }
  );
  app.delete<{ Params: { id: string } }>(
    "/v2/ai/overview/snapshots/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = await dependencies.resolveUserId(request);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno." });
      if (!dependencies.overviewSnapshots)
        return reply.code(503).send({ message: "Ukládání přehledů není dostupné." });
      if (!(await dependencies.overviewSnapshots.remove(owner, request.params.id)))
        return reply.code(404).send({ message: "Přehled není dostupný." });
      return { deleted: true };
    }
  );
  app.get("/v2/ai/overview/snapshots", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const owner = await dependencies.resolveUserId(request);
    if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno." });
    if (!dependencies.overviewSnapshots)
      return reply.code(503).send({ message: "Ukládání přehledů není dostupné." });
    return { snapshots: await dependencies.overviewSnapshots.list(owner) };
  });
  app.get<{ Params: { id: string } }>(
    "/v2/ai/overview/snapshots/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = await dependencies.resolveUserId(request);
      if (!owner) return reply.code(401).send({ message: "Přihlášení je vyžadováno." });
      const snapshot = await dependencies.overviewSnapshots?.get(owner, request.params.id);
      if (
        !snapshot ||
        (snapshot.recipe.target.type === "poi" &&
          !dependencies.allowedLayerIds.has(snapshot.recipe.target.layerId))
      )
        return reply.code(404).send({ message: "Přehled není dostupný." });
      if (snapshot.recipe.target.type === "area") {
        const target = snapshot.recipe.target;
        const area = await dependencies
          .resolveArea?.({ areaId: target.areaId, boundaryRevision: target.boundaryRevision })
          .catch(() => null);
        if (!area)
          return reply
            .code(409)
            .send({ message: "Obnovte výběr oblasti; původní vydání již není dostupné." });
      }
      return snapshot;
    }
  );
}
