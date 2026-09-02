import type { FastifyInstance } from "fastify";
import type { Bbox } from "@mapos/layer-sdk";
import {
  discoverContextService,
  type DiscoverContextInput,
  type DiscoverContextService
} from "../services/discoverService.js";

export interface DiscoverContextRouteOptions {
  service?: Pick<DiscoverContextService, "get">;
}

function numberParam(raw: string | undefined, name: string, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function bboxParam(raw: string | undefined): Bbox | undefined {
  if (!raw) return undefined;
  const values = raw.split(",").map(Number);
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
    throw new Error("bbox must be west,south,east,north");
  }
  return values as Bbox;
}

/** A thin transport controller; source ordering, cache and fallback policy live in the service. */
export function registerDiscoverContextRoutes(
  app: FastifyInstance,
  options: DiscoverContextRouteOptions = {}
) {
  const service = options.service ?? discoverContextService;
  app.get<{
    Querystring: {
      lng?: string;
      lat?: string;
      zoom?: string;
      bbox?: string;
      lang?: string;
      useCase?: string;
      layers?: string;
      model?: string;
    };
  }>("/v2/discover/context", async (request, reply) => {
    let input: DiscoverContextInput;
    try {
      const activeLayerIds = [...new Set((request.query.layers ?? "").split(","))]
        .map((value) => value.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 32);
      input = {
        lng: numberParam(request.query.lng, "lng", -180, 180),
        lat: numberParam(request.query.lat, "lat", -90, 90),
        zoom: numberParam(request.query.zoom, "zoom", 0, 24),
        bbox: bboxParam(request.query.bbox),
        lang: (request.query.lang ?? "cs").slice(0, 2).toLowerCase(),
        useCase: request.query.useCase?.slice(0, 64),
        activeLayerIds,
        allowModelFallback: request.query.model === "1"
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Invalid discover context request"
      });
    }
    const context = await service.get(input);
    const maxAge = context.cache.hit ? 300 : 60;
    return reply.header("cache-control", `private, max-age=${maxAge}`).send(context);
  });
}
