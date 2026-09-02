/** Basemap tile proxy. One route for every keyed provider; keyless backgrounds never come
 *  through here. Registered on the in-memory server too, where it answers 503 for everything —
 *  which is exactly what a deployment without keys does, so the frontend gets the same shape. */

import type { FastifyInstance } from "fastify";
import { fetchBasemapTile, TileProviderUnavailableError } from "../services/basemapService.js";

export function registerBasemapRoutes(app: FastifyInstance) {
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
    if (!Object.values(coords).every(Number.isFinite)) {
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
      return reply
        .header("content-type", tile.contentType)
        .header("cache-control", "public, max-age=604800, immutable")
        .send(Buffer.from(tile.body));
    } catch (err) {
      if (err instanceof TileProviderUnavailableError) {
        return reply.code(503).send({ message: `${provider} není nakonfigurováno` });
      }
      return reply.code(502).send({ message: "tile fetch failed" });
    }
  });
}
