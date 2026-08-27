/** Content routes for the place detail's panels. Registered on both servers — none of them need
 *  a database, so the detail stays fully functional against the in-memory API. */

import type { FastifyInstance } from "fastify";
import {
  getFoursquareDetail,
  getPointForecast,
  getWikidataFacts,
  getWikipediaArticle
} from "../services/infoService.js";

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

  app.get<{ Querystring: { fsqId?: string } }>("/info/foursquare", async (request, reply) => {
    const fsqId = request.query.fsqId?.trim();
    if (!fsqId) return reply.code(400).send({ message: "fsqId required" });
    const detail = await getFoursquareDetail(fsqId);
    if (!detail) return reply.code(404).send({ message: "Venue not found" });
    return reply.header("cache-control", "public, max-age=3600").send(detail);
  });
}
