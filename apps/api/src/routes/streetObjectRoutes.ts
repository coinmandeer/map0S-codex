import type { FastifyInstance } from "fastify";
import {
  fetchStreetObjectTile,
  isStreetObjectSource,
  StreetObjectsUnavailableError
} from "../services/streetObjectsService.js";

/**
 * Mapillary street-object tile proxy.
 *
 * The access token is a server secret, so the browser asks our origin for tiles and the server
 * adds the key. That keeps it out of the URL bar, out of `Referer`, and out of request logs —
 * which a direct `?access_token=` from the browser would not.
 *
 * Registered on both servers. Without a token the route answers 503, which is exactly what a
 * keyless deployment does, so the frontend sees the same shape everywhere.
 */
export function registerStreetObjectRoutes(app: FastifyInstance) {
  app.get<{ Params: { source: string; z: string; x: string; y: string } }>(
    "/street-objects/:source/:z/:x/:y",
    {
      schema: {
        params: {
          type: "object",
          required: ["source", "z", "x", "y"],
          properties: {
            source: { type: "string", enum: ["point", "sign"] },
            z: { type: "string", maxLength: 3 },
            x: { type: "string", maxLength: 10 },
            y: { type: "string", maxLength: 10 }
          }
        }
      }
    },
    async (request, reply) => {
      const { source, z, x, y } = request.params;
      if (!isStreetObjectSource(source)) {
        return reply.code(400).send({ message: "unknown street-object source" });
      }
      const coords = { z: Number(z), x: Number(x), y: Number(y.replace(/\.pbf$/, "")) };
      if (!Object.values(coords).every(Number.isFinite)) {
        return reply.code(400).send({ message: "bad tile coordinates" });
      }
      try {
        const tile = await fetchStreetObjectTile(source, coords.z, coords.x, coords.y);
        // Objects and signs change on the order of months; a week of cache keeps a pan from
        // becoming a burst of upstream requests.
        return reply
          .header("content-type", tile.contentType || "application/x-protobuf")
          .header("cache-control", "public, max-age=604800, immutable")
          .send(Buffer.from(tile.body));
      } catch (error) {
        if (error instanceof StreetObjectsUnavailableError) {
          return reply.code(503).send({ message: "Mapillary není nakonfigurováno" });
        }
        return reply.code(502).send({ message: "tile fetch failed" });
      }
    }
  );
}
