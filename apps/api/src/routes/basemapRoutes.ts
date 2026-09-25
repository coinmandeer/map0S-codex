import { ProviderBudgetError } from "../services/providerBudget/policy.js";
/** Basemap tile proxy. One route for every keyed provider; keyless backgrounds never come
 *  through here. Registered on the in-memory server too, where it answers 503 for everything —
 *  which is exactly what a deployment without keys does, so the frontend gets the same shape. */

import type { FastifyInstance } from "fastify";
import {
  fetchBasemapTile,
  googleViewport,
  TileProviderUnavailableError
} from "../services/basemapService.js";

export function registerBasemapRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { bbox: string; zoom: string; mapset: string } }>(
    "/basemap/google/viewport",
    async (req, reply) => {
      const bbox = (req.query.bbox ?? "").split(",").map(Number);
      const zoom = Number(req.query.zoom);
      if (
        bbox.length !== 4 ||
        !bbox.every(Number.isFinite) ||
        !Number.isInteger(zoom) ||
        zoom < 0 ||
        zoom > 22 ||
        bbox[0]! < -180 ||
        bbox[2]! > 180 ||
        bbox[1]! < -90 ||
        bbox[3]! > 90 ||
        bbox[0] === bbox[2] ||
        bbox[1]! >= bbox[3]!
      )
        return reply.code(400).send({ message: "Neplatný výřez" });
      try {
        return reply
          .header("cache-control", "private, no-store")
          .send(
            await googleViewport(req.query.mapset, bbox as [number, number, number, number], zoom)
          );
      } catch {
        return reply.code(503).send({ message: "Atribuce Google není dostupná" });
      }
    }
  );
  app.get<{
    Params: { provider: string; mapset: string; z: string; x: string; y: string };
    Querystring: { retina?: string };
  }>("/basemap/:provider/:mapset/:z/:x/:y", async (request, reply) => {
    const { provider, mapset, z, x, y } = request.params;
    const coords = {
      z: Number(z),
      x: Number(x),
      // MapLibre appends no extension, but a hand-written URL might.
      y: Number(y.replace(/\.(png|jpe?g|webp)$/, ""))
    };
    if (
      !Object.values(coords).every(Number.isInteger) ||
      coords.z < 0 ||
      coords.z > 22 ||
      coords.x < 0 ||
      coords.y < 0 ||
      coords.x >= 2 ** coords.z ||
      coords.y >= 2 ** coords.z
    ) {
      return reply.code(400).send({ message: "bad tile coordinates" });
    }

    try {
      const tile = await fetchBasemapTile(provider, {
        mapset,
        ...coords,
        retina: request.query.retina === "1"
      });
      // Basemap tiles change on the order of months. Caching them hard is what keeps a proxy
      // from turning every pan into an upstream request — and into billed quota.
      if (provider === "google" && tile.etag) reply.header("etag", tile.etag);
      return reply
        .header("content-type", tile.contentType)
        .header(
          "cache-control",
          provider === "google"
            ? (tile.cacheControl ?? "private, no-store")
            : "public, max-age=604800, immutable"
        )
        .send(Buffer.from(tile.body));
    } catch (err) {
      if (err instanceof ProviderBudgetError)
        return reply.code(503).header("cache-control", "no-store").send({ message: err.message });
      if (err instanceof TileProviderUnavailableError) {
        return reply.code(503).send({ message: `${provider} není nakonfigurováno` });
      }
      return reply.code(502).send({ message: "tile fetch failed" });
    }
  });
}
