import type { FastifyInstance } from "fastify";
import { withRequestSignal } from "../utils/requestSignal.js";
import {
  satelliteCatalog,
  satelliteCategoryIds,
  SATELLITE_CATEGORIES
} from "../services/satelliteService.js";

/**
 * Orbital elements for satellites (CelesTrak). Keyless, so registered on both servers and fully
 * live offline.
 *
 * Returns elements, not positions: the browser propagates them with SGP4 so a satellite moves
 * smoothly along its ground track without this endpoint being polled every second.
 */
export function registerSatelliteRoutes(app: FastifyInstance) {
  app.get("/satellites/categories", async () => ({
    categories: SATELLITE_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      hint: category.hint,
      defaultOn: Boolean(category.defaultOn)
    }))
  }));

  app.get<{ Querystring: { categories?: string } }>(
    "/satellites/elements",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { categories: { type: "string", maxLength: 240 } }
        }
      }
    },
    async (request, reply) => {
      const allowed = new Set(satelliteCategoryIds());
      const requested = [...new Set((request.query.categories ?? "").split(","))]
        .map((value) => value.trim())
        .filter((value) => allowed.has(value))
        .slice(0, 12);
      try {
        const catalog = await withRequestSignal(request, reply, (signal) =>
          satelliteCatalog(requested, signal)
        );
        return reply.header("cache-control", "public, max-age=900").send(catalog);
      } catch {
        return reply.code(502).send({ message: "Katalog družic se nepodařilo načíst." });
      }
    }
  );
}
