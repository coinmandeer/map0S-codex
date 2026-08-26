/** Mapy.com proxy routes. Registered on both the real and the in-memory server so the
 *  frontend behaves identically in e2e runs (there they simply 503 without a key). */

import type { FastifyInstance } from "fastify";
import {
  fetchMapyTile,
  isMapyMapset,
  mapyGeocode,
  mapySuggest,
  MapyNotConfiguredError,
  MAPY_ATTRIBUTION
} from "../services/mapyService.js";
import { config } from "../config.js";

function notConfigured(err: unknown): boolean {
  return err instanceof MapyNotConfiguredError;
}

export function registerMapyRoutes(app: FastifyInstance) {
  app.get("/mapy/attribution", async () => ({
    attribution: MAPY_ATTRIBUTION,
    logoUrl: "https://api.mapy.com/img/api/logo.svg",
    enabled: Boolean(config.mapyKey)
  }));

  app.get<{
    Params: { mapset: string; z: string; x: string; y: string };
    Querystring: { retina?: string };
  }>("/mapy/tiles/:mapset/:z/:x/:y", async (request, reply) => {
    const { mapset, z, x, y } = request.params;
    if (!isMapyMapset(mapset)) return reply.code(400).send({ message: "unknown mapset" });
    try {
      const tile = await fetchMapyTile(
        mapset,
        Number(z),
        Number(x),
        Number(y.replace(/\.(png|jpe?g|webp)$/, "")),
        request.query.retina === "1"
      );
      // Mapy raster tiles are stable; a long cache is what keeps this proxy from becoming the
      // bottleneck (and from burning credits on every pan).
      return reply
        .header("content-type", tile.contentType)
        .header("cache-control", "public, max-age=604800, immutable")
        .send(Buffer.from(tile.body));
    } catch (err) {
      if (notConfigured(err))
        return reply.code(503).send({ message: "Mapy.com není nakonfigurováno" });
      return reply.code(502).send({ message: "tile fetch failed" });
    }
  });

  app.get<{ Querystring: { q?: string; lang?: string; limit?: string } }>(
    "/mapy/geocode",
    async (request, reply) => {
      const q = (request.query.q ?? "").trim();
      if (q.length < 2) return { results: [] };
      try {
        const items = await mapyGeocode(
          q,
          request.query.lang ?? "cs",
          Number(request.query.limit ?? 8)
        );
        return { results: items };
      } catch (err) {
        if (notConfigured(err)) return reply.code(503).send({ results: [] });
        return reply.code(502).send({ results: [] });
      }
    }
  );

  app.get<{ Querystring: { q?: string; lang?: string; bbox?: string; limit?: string } }>(
    "/mapy/suggest",
    async (request, reply) => {
      const q = (request.query.q ?? "").trim();
      if (q.length < 2) return { results: [] };
      const bboxRaw = request.query.bbox?.split(",").map(Number);
      const bbox =
        bboxRaw?.length === 4 && bboxRaw.every(Number.isFinite)
          ? ([bboxRaw[0]!, bboxRaw[1]!, bboxRaw[2]!, bboxRaw[3]!] as [
              number,
              number,
              number,
              number
            ])
          : undefined;
      try {
        const items = await mapySuggest({
          query: q,
          lang: request.query.lang ?? "cs",
          limit: Number(request.query.limit ?? 15),
          bbox
        });
        return { results: items };
      } catch (err) {
        if (notConfigured(err)) return reply.code(503).send({ results: [] });
        return reply.code(502).send({ results: [] });
      }
    }
  );
}
