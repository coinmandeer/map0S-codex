import type { Bbox } from "@mapos/layer-sdk";
import { getAirQualityGrid, airCells } from "../services/airQualityGrid.js";
import type { FastifyInstance } from "fastify";
import { getDroughtEdition } from "../services/droughtEdition.js";
import { withRequestSignal } from "../utils/requestSignal.js";
export function registerEnvironmentEditionRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { bbox: string } }>(
    "/environment/air-quality/grid",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["bbox"],
          properties: { bbox: { type: "string", minLength: 7, maxLength: 100 } }
        }
      }
    },
    async (request, reply) => {
      const values = request.query.bbox.split(",").map(Number);
      if (values.length !== 4) return reply.code(400).send({ code: "bbox-invalid" });
      const bbox = values as Bbox;
      try {
        airCells(bbox);
      } catch {
        return reply.code(400).send({ code: "bbox-invalid" });
      }
      try {
        const result = await withRequestSignal(request, reply, (signal) =>
          getAirQualityGrid(bbox, signal)
        );
        return reply
          .header("cache-control", result.status === "complete" ? "public, max-age=60" : "no-store")
          .send(result);
      } catch {
        return reply
          .code(503)
          .header("cache-control", "no-store")
          .send({ code: "model-unavailable", message: "Model ovzduší se nepodařilo načíst." });
      }
    }
  );
  app.get("/environment/drought/edition", async (request, reply) => {
    try {
      const result = await withRequestSignal(request, reply, getDroughtEdition);
      return reply.header("cache-control", "public, max-age=3600").send(result);
    } catch {
      return reply.code(503).header("cache-control", "no-store").send({
        code: "edition-unavailable",
        message: "Dostupnou edici sucha se nepodařilo ověřit."
      });
    }
  });
}
