import type { FastifyInstance } from "fastify";
import { FixedWindowRateLimiter, rateLimitByIp } from "../security/publicApiHardening.js";
import { withRequestSignal } from "../utils/requestSignal.js";
import { parseBbox } from "../services/liveTraffic/types.js";
import { aircraftInView, aisCollector, vesselsInView } from "../services/liveTraffic/index.js";

const limiter = new FixedWindowRateLimiter();

const BBOX_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bbox"],
  properties: { bbox: { type: "string", maxLength: 80 } }
} as const;

/** Live air and sea traffic.
 *
 * Both endpoints take the viewport the client is actually looking at and answer with the
 * objects inside it: the upstream sees one polite, cached, server-side caller per area instead
 * of one per browser tab, and the browser never learns the provider keys. Attribution and the
 * age of each position travel with the features. */
export function registerLiveTrafficRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { bbox: string } }>(
    "/live/aircraft",
    {
      schema: { querystring: BBOX_QUERY_SCHEMA },
      preHandler: rateLimitByIp(limiter, {
        bucket: "live-aircraft",
        limit: 120,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      const bbox = parseBbox(request.query.bbox);
      if (!bbox)
        return reply.code(400).send({ message: "Zadejte výřez jako bbox=západ,jih,východ,sever." });
      try {
        const result = await withRequestSignal(request, reply, (signal) =>
          aircraftInView(bbox, signal)
        );
        return reply
          .header("cache-control", "public, max-age=5")
          .send({ ...result, status: result.status });
      } catch {
        return reply.code(502).send({ message: "Letecká data se teď nepodařilo načíst." });
      }
    }
  );

  app.get<{ Querystring: { bbox: string } }>(
    "/live/vessels",
    {
      schema: { querystring: BBOX_QUERY_SCHEMA },
      preHandler: rateLimitByIp(limiter, {
        bucket: "live-vessels",
        limit: 120,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      const bbox = parseBbox(request.query.bbox);
      if (!bbox)
        return reply.code(400).send({ message: "Zadejte výřez jako bbox=západ,jih,východ,sever." });
      try {
        const result = await withRequestSignal(request, reply, (signal) =>
          vesselsInView(bbox, signal)
        );
        return reply.header("cache-control", "public, max-age=5").send(result);
      } catch {
        return reply.code(502).send({ message: "Lodní data se teď nepodařilo načíst." });
      }
    }
  );

  // A diagnostic that says whether the global stream is configured and connected, without
  // exposing the key or any vessel. Ops can tell "no ships here" from "collector down".
  app.get("/live/status", async () => ({
    aircraft: { source: "adsblol", keyless: true },
    vessels: aisCollector.status
  }));
}
