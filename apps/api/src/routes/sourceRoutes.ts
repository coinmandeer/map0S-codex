import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SourceProbe } from "@mapos/adapter-sdk";
import type { Bbox, FeatureCollection, LayerCategoryV2, LayerManifestV2 } from "@mapos/layer-sdk";
import {
  describeSource,
  probeSource,
  SourceRequestError,
  type SourceProbeResult
} from "../services/sourceService.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { querySourceFeatures } from "../services/sourceFeatures.js";
import { createSourceLayer, ownedSourceManifest } from "../services/userLayerService.js";

/**
 * The two requests the "add source from URL" wizard makes.
 *
 * Two rather than one because they are separated by a human decision: `probe` reports what a URL
 * turned out to be, the user picks which sublayers they want, and `layers` builds and stores the
 * manifest. Doing it in one request would mean either probing twice or making the choice for
 * them, and a service publishing four hundred layers makes that choice badly.
 *
 * The probe travels through the client between the two, so `describeSource` validates it rather
 * than trusting it.
 */
const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;

const SUBLAYER = {
  type: "object",
  additionalProperties: true,
  required: ["id", "title", "selectable"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 240 },
    title: { type: "string", maxLength: 400 },
    selectable: { type: "boolean" }
  }
} as const;

const PROBE_BODY = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["url"],
  properties: { url: { type: "string", minLength: 8, maxLength: 2048 } }
} as const;

/** A service can publish a great many layers, and the probe carries them all back so the user
 *  can filter without another request — but the ceiling keeps a hostile response from becoming
 *  a large insert. */
const CREATE_BODY = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["url", "probe"],
  properties: {
    url: { type: "string", minLength: 8, maxLength: 2048 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    category: { type: "string", maxLength: 40 },
    isPublic: { type: "boolean" },
    sublayerIds: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 240 }
    },
    probe: {
      type: "object",
      additionalProperties: true,
      required: ["adapterId", "kind", "delivery", "endpoint", "title", "sublayers"],
      properties: {
        adapterId: { type: "string", maxLength: 40 },
        kind: { type: "string", maxLength: 40 },
        delivery: { enum: ["tiles", "features"] },
        endpoint: { type: "string", maxLength: 2048 },
        title: { type: "string", maxLength: 400 },
        sublayers: { type: "array", maxItems: 2000, items: SUBLAYER }
      }
    }
  }
} as const;

export const SOURCE_PROBE_SCHEMA = { body: PROBE_BODY } as const;
export const SOURCE_CREATE_SCHEMA = { body: CREATE_BODY } as const;

export interface SourceLayerInput {
  name: string;
  color?: string;
  sourceUrl: string;
  sourceManifest: LayerManifestV2;
  sourceAdapterId: string;
  isPublic?: boolean;
}

export interface SourceRouteDependencies {
  resolveUserId(request: FastifyRequest): Promise<string | null>;
  /** Overridden offline, where the probe reads fixtures instead of the network. */
  probe?(url: string): Promise<SourceProbeResult>;
  /** Overridden offline, where there is no Postgres to insert into. */
  loadManifest?(layerId: string, userId: string): Promise<LayerManifestV2 | null>;
  features?(
    manifest: LayerManifestV2,
    layerId: string,
    bbox: Bbox,
    signal: AbortSignal
  ): Promise<FeatureCollection>;
  createLayer?(userId: string, input: SourceLayerInput): Promise<{ id: string; name: string }>;
}

export function registerSourceRoutes(
  app: FastifyInstance,
  dependencies: SourceRouteDependencies
): void {
  const probe = dependencies.probe ?? probeSource;
  const createLayer = dependencies.createLayer ?? createSourceLayer;

  app.get<{ Params: { id: string }; Querystring: { bbox: string } }>(
    "/v2/sources/layers/:id/features",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } }
        },
        querystring: {
          type: "object",
          required: ["bbox"],
          additionalProperties: false,
          properties: { bbox: { type: "string", maxLength: 160 } }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const userId = await dependencies.resolveUserId(request);
      if (!userId) return reply.code(401).send({ message: "Unauthorized" });
      const values = request.query.bbox
        .split(",")
        .map((value) => (value.trim() ? Number(value) : NaN));
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
        return reply.code(400).send({ message: "Neplatný výřez mapy." });
      }
      // The normal viewport policy starts at z9; direct callers must not ask a continent of geometry.
      if (values[2]! - values[0]! > 10 || values[3]! - values[1]! > 10) {
        return reply.code(422).send({ message: "Pro tuto vrstvu přibliž mapu." });
      }
      const abort = new AbortController();
      const close = () => abort.abort();
      request.raw.once("aborted", close);
      reply.raw.once("close", close);
      const timer = setTimeout(close, 20000);
      try {
        const manifest = await (dependencies.loadManifest ?? ownedSourceManifest)(
          request.params.id,
          userId
        );
        if (!manifest) return reply.code(404).send({ message: "Layer not found" });
        const result = await (dependencies.features ?? querySourceFeatures)(
          manifest,
          request.params.id,
          values as Bbox,
          abort.signal
        );
        return reply.send(result);
      } catch (error) {
        return failure(reply, error);
      } finally {
        clearTimeout(timer);
        request.raw.off("aborted", close);
        reply.raw.off("close", close);
      }
    }
  );

  app.post<{ Body: { url: string } }>(
    "/v2/sources/probe",
    { schema: SOURCE_PROBE_SCHEMA },
    async (request, reply) => {
      // Probing costs an upstream request against a URL the caller chose, so it is not something
      // an anonymous visitor gets to do.
      const userId = await dependencies.resolveUserId(request);
      if (!userId) return reply.code(401).send({ message: "Unauthorized" });
      try {
        return reply
          .header("cache-control", "private, no-store")
          .send(await probe(request.body.url));
      } catch (error) {
        return failure(reply, error);
      }
    }
  );

  app.post<{
    Body: {
      url: string;
      probe: SourceProbe;
      sublayerIds?: string[];
      name?: string;
      color?: string;
      category?: string;
      isPublic?: boolean;
    };
  }>("/v2/sources/layers", { schema: SOURCE_CREATE_SCHEMA }, async (request, reply) => {
    const userId = await dependencies.resolveUserId(request);
    if (!userId) return reply.code(401).send({ message: "Unauthorized" });
    try {
      const manifest = describeSource({
        probe: request.body.probe,
        sublayerIds: request.body.sublayerIds ?? [],
        ...(request.body.name ? { name: request.body.name } : {}),
        ...(request.body.category ? { category: request.body.category as LayerCategoryV2 } : {})
      });
      const layer = await createLayer(userId, {
        name: request.body.name ?? manifest.name,
        ...(request.body.color ? { color: request.body.color } : {}),
        sourceUrl: request.body.url,
        sourceManifest: manifest,
        sourceAdapterId: request.body.probe.adapterId,
        ...(request.body.isPublic !== undefined ? { isPublic: request.body.isPublic } : {})
      });
      return reply.code(201).header("cache-control", "private, no-store").send({ layer });
    } catch (error) {
      return failure(reply, error);
    }
  });
}

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof SourceRequestError) {
    return reply.code(error.status).send({ message: error.message });
  }
  reply.log.error(safeErrorLogFields(error), "source request failed");
  return reply.code(500).send({ message: "Zdroj se nepodařilo zpracovat." });
}
