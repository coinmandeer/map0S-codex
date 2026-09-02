/** Content routes for the place detail's panels. Registered on both servers — none of them need
 *  a database, so the detail stays fully functional against the in-memory API. */

import type { FastifyInstance } from "fastify";
import { FixedWindowRateLimiter, rateLimitByIp } from "../security/publicApiHardening.js";
import { getPlaceBrief } from "../services/briefService.js";
import { checkEmbeddable } from "../services/embedService.js";
import { getGeologyAt } from "../services/geologyService.js";
import {
  getFoursquareDetail,
  getPointForecast,
  getWikidataFacts,
  getWikipediaArticle
} from "../services/infoService.js";

const briefLimiter = new FixedWindowRateLimiter();
const BRIEF_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lng", "lat"],
  properties: {
    lng: { type: "string", minLength: 1, maxLength: 24 },
    lat: { type: "string", minLength: 1, maxLength: 24 },
    name: { type: "string", maxLength: 120 },
    category: { type: "string", maxLength: 64 },
    qid: { type: "string", pattern: "^Q[1-9][0-9]{0,11}$" }
  }
} as const;

/** A panel that has nothing to show should collapse quietly rather than render an error, so a
 *  missing article is a 404 with a message and never a 500. */
export function registerInfoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { qid?: string; title?: string; lang?: string } }>(
    "/info/wikipedia",
    async (request, reply) => {
      const { qid, title, lang } = request.query;
      if (!qid && !title) return reply.code(400).send({ message: "qid or title required" });
      const article = await getWikipediaArticle({ qid, title, lang });
      if (!article) return reply.code(404).send({ message: "Article not found" });
      return reply.header("cache-control", "public, max-age=3600").send(article);
    }
  );

  app.get<{ Querystring: { qid?: string } }>("/info/wikidata", async (request, reply) => {
    const qid = request.query.qid?.trim();
    if (!qid) return reply.code(400).send({ message: "qid required" });
    try {
      const facts = await getWikidataFacts(qid);
      if (!facts) return reply.code(404).send({ message: "Entity not found" });
      return reply.header("cache-control", "public, max-age=86400").send(facts);
    } catch {
      return reply.code(502).send({ message: "Wikidata je nedostupná" });
    }
  });

  app.get<{ Querystring: { lng?: string; lat?: string } }>(
    "/info/weather",
    async (request, reply) => {
      const lng = Number(request.query.lng);
      const lat = Number(request.query.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      try {
        const forecast = await getPointForecast(lng, lat);
        return reply.header("cache-control", "public, max-age=1800").send(forecast);
      } catch {
        return reply.code(502).send({ message: "Předpověď je nedostupná" });
      }
    }
  );

  app.get<{ Querystring: { url?: string } }>("/info/embeddable", async (request, reply) => {
    const url = request.query.url?.trim();
    if (!url) return reply.code(400).send({ message: "url required" });
    const probe = await checkEmbeddable(url);
    // An unknown verdict is not cached for long: it usually means the probe timed out, and the
    // site may well be reachable next time.
    const maxAge = probe.verdict === "unknown" ? 300 : 86_400;
    return reply.header("cache-control", `public, max-age=${maxAge}`).send(probe);
  });

  app.get<{ Querystring: { lng?: string; lat?: string } }>(
    "/info/geology",
    async (request, reply) => {
      const lng = Number(request.query.lng);
      const lat = Number(request.query.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      const report = await getGeologyAt(lng, lat);
      if (!report) return reply.code(404).send({ message: "Pro toto místo geologii nemáme" });
      // The bedrock is the most cacheable thing on the map.
      return reply.header("cache-control", "public, max-age=604800").send(report);
    }
  );

  app.get<{
    Querystring: { lng?: string; lat?: string; name?: string; category?: string; qid?: string };
  }>(
    "/info/brief",
    {
      schema: { querystring: BRIEF_QUERY_SCHEMA },
      preHandler: rateLimitByIp(briefLimiter, {
        bucket: "public-place-brief",
        limit: 30,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      const lng = Number(request.query.lng);
      const lat = Number(request.query.lat);
      if (
        !Number.isFinite(lng) ||
        !Number.isFinite(lat) ||
        lng < -180 ||
        lng > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        return reply.code(400).send({ message: "valid lng and lat required" });
      }
      const brief = await getPlaceBrief({
        lng,
        lat,
        name: request.query.name?.trim() || undefined,
        category: request.query.category?.trim() || undefined,
        qid: request.query.qid?.trim() || undefined
      });
      // Nothing generated and no neighbours means there is genuinely nothing to say here.
      if (!brief.text && !brief.nearby.length) {
        return reply.code(404).send({ message: "K tomuto místu zatím nic nemáme" });
      }
      return reply.header("cache-control", "public, max-age=3600").send(brief);
    }
  );

  app.get<{ Querystring: { fsqId?: string } }>("/info/foursquare", async (request, reply) => {
    const fsqId = request.query.fsqId?.trim();
    if (!fsqId) return reply.code(400).send({ message: "fsqId required" });
    const detail = await getFoursquareDetail(fsqId);
    if (!detail) return reply.code(404).send({ message: "Venue not found" });
    return reply.header("cache-control", "public, max-age=3600").send(detail);
  });
}
