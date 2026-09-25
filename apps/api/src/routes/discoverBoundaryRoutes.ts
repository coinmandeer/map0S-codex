import { cachedBoundaryTile } from "../geo/boundaryTileCache.js";
import { messageForClient, statusForClient } from "../utils/clientError.js";
import { resolveAreaSelection, selectedAreaGeometry } from "../geo/areaSelection.js";
import type { FastifyInstance } from "fastify";
import {
  boundaryRepository,
  DISCOVER_BOUNDARY_LEVELS,
  type BoundaryRepository,
  type DiscoverBoundaryLevel
} from "../geo/discoverBoundaries.js";

export function registerDiscoverBoundaryRoutes(
  app: FastifyInstance,
  repository: BoundaryRepository = boundaryRepository
) {
  app.get<{ Querystring: { areaId?: string; boundaryRevision?: string; geometry?: string } }>(
    "/v2/discover/area",
    async (request, reply) => {
      try {
        const area = await resolveAreaSelection(request.query);
        if (!area) return reply.code(400).send({ message: "Vyberte oblast" });
        return reply
          .header("cache-control", "public,max-age=31536000,immutable")
          .send(
            request.query.geometry === "1"
              ? { ...area, geometry: await selectedAreaGeometry(area) }
              : area
          );
      } catch (error) {
        return reply
          .code(statusForClient(error))
          .send({ message: messageForClient(error, "Oblast není dostupná") });
      }
    }
  );
  let metadata: { value: unknown; expires: number } | undefined;
  let metadataFlight: Promise<unknown> | undefined;
  // Coverage is a pure function of the published revision and the expensive half of this
  // answer; only the cheap manifest lookup repeats every minute.
  let revisionCoverage: { revision: string; coverage: unknown[] } | undefined;
  async function boundaryMetadata() {
    if (metadata && Date.now() < metadata.expires) return metadata.value;
    if (metadataFlight) return metadataFlight;
    metadataFlight = (async () => {
      const revision = await repository.manifest?.();
      const coverage =
        revision && revisionCoverage?.revision === revision
          ? revisionCoverage.coverage
          : await repository.coverage(revision ?? undefined);
      if (revision) revisionCoverage = { revision, coverage };
      const value = {
        coverage,
        ready: coverage.length > 0,
        sourceLayer: "boundaries",
        revision: revision ?? null,
        tileTemplate: `/v2/discover/boundaries/${revision ? revision + "/" : ""}{level}/{z}/{x}/{y}.mvt`
      };
      metadata = { value, expires: Date.now() + 60000 };
      return value;
    })().finally(() => {
      metadataFlight = undefined;
    });
    return metadataFlight;
  }
  app.get("/v2/discover/boundaries", async (_request, reply) =>
    reply.header("cache-control", "public,max-age=60").send(await boundaryMetadata())
  );
  app.get<{ Params: { level: string; z: string; x: string; y: string } }>(
    "/v2/discover/boundaries/:level/:z/:x/:y.mvt",
    async (request, reply) => {
      const { level } = request.params;
      const [z, x, y] = [request.params.z, request.params.x, request.params.y].map(Number) as [
        number,
        number,
        number
      ];
      if (
        !DISCOVER_BOUNDARY_LEVELS.includes(level as DiscoverBoundaryLevel) ||
        ![z, x, y].every(Number.isInteger) ||
        z < 0 ||
        z > 14 ||
        x < 0 ||
        y < 0 ||
        x >= 2 ** z ||
        y >= 2 ** z
      ) {
        return reply.code(400).send({ message: "Invalid boundary tile" });
      }
      const tile = await repository.tile(level as DiscoverBoundaryLevel, z, x, y);
      return reply
        .header("content-type", "application/vnd.mapbox-vector-tile")
        .header("cache-control", "public,max-age=60")
        .send(Buffer.from(tile));
    }
  );
  app.get<{
    Params: { revision: string; level: string; z: string; x: string; y: string };
    Querystring: { areaId?: string };
  }>("/v2/discover/boundaries/:revision/:level/:z/:x/:y.mvt", async (request, reply) => {
    const { revision, level } = request.params;
    const [z, x, y] = [request.params.z, request.params.x, request.params.y].map(Number) as [
      number,
      number,
      number
    ];
    if (
      !/^[a-f0-9]{64}$/.test(revision) ||
      !DISCOVER_BOUNDARY_LEVELS.includes(level as DiscoverBoundaryLevel) ||
      ![z, x, y].every(Number.isInteger) ||
      z < 0 ||
      z > 14 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    ) {
      return reply.code(400).send({ message: "Invalid boundary tile" });
    }
    if (!repository.manifest)
      return reply.code(404).send({ message: "Boundary edition is unavailable" });
    const scope = request.query.areaId
      ? await resolveAreaSelection({ areaId: request.query.areaId, boundaryRevision: revision })
      : null;
    const tile = await cachedBoundaryTile([revision, level, z, x, y, scope?.id ?? null], () =>
      repository.tile(level as DiscoverBoundaryLevel, z, x, y, revision, scope)
    );
    return reply
      .header("content-type", "application/vnd.mapbox-vector-tile")
      .header("cache-control", "public,max-age=31536000,immutable")
      .send(Buffer.from(tile));
  });
}
