import type { FastifyInstance } from "fastify";
import type { Bbox } from "@mapos/layer-sdk";

function parseBbox(raw: string | undefined): Bbox | null {
  const values = raw?.split(",").map(Number);
  if (!values || values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values as Bbox;
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90)
    return null;
  return [west, south, east, north];
}

export function registerBathymetryGridRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { bbox?: string; cols?: string; rows?: string } }>(
    "/environment/bathymetry/grid",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["bbox"],
          properties: {
            bbox: { type: "string", minLength: 7, maxLength: 100 },
            cols: { type: "string", pattern: "^[0-9]{1,2}$" },
            rows: { type: "string", pattern: "^[0-9]{1,2}$" }
          }
        }
      }
    },
    async (request, reply) => {
      const bbox = parseBbox(request.query.bbox);
      if (!bbox) return reply.code(400).send({ code: "bbox-invalid" });
      // Keep the endpoint compatible for older clients, but never turn individual WMS
      // point samples into supposed area medians. Re-enable only with a published numeric edition.
      return reply.code(503).header("cache-control", "no-store").send({
        code: "bathymetry-numeric-data-pending",
        status: "unavailable",
        message: "Číselná data se připravují. Dostupný je mapový přehled EMODnet."
      });
    }
  );
}
