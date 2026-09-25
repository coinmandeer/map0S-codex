import { panoramaxPanorama, streetPanorama } from "../services/panoramaService.js";
import { areaPopulation } from "../services/populationAreaService.js";
import { foursquarePlaces } from "../services/foursquarePlaces.js";
import { ProviderBudgetError } from "../services/providerBudget/policy.js";
import { withRequestSignal } from "../utils/requestSignal.js";
/** Shared detail routes. Quota-limited enrichment requires the persistent budget database;
 * unavailable admission fails closed while open detail sources remain usable. */

import type { FastifyInstance } from "fastify";
import { FixedWindowRateLimiter, rateLimitByIp } from "../security/publicApiHardening.js";
import { checkEmbeddable } from "../services/embedService.js";
import { getGeologyAt } from "../services/geologyService.js";
import {
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
    qid: { type: "string", pattern: "^Q[1-9][0-9]{0,11}$" },
    layerId: { type: "string", maxLength: 100 },
    layerName: { type: "string", maxLength: 100 },
    /** `label=value` pairs joined by `|`: the pin's own fields, which is what makes the summary
     *  about this pin rather than about this street corner. */
    facts: { type: "string", maxLength: 800 },
    web: { type: "string", enum: ["1"] }
  }
} as const;

/** A panel that has nothing to show should collapse quietly rather than render an error, so a
 *  missing article is a 404 with a message and never a 500. */
export function registerInfoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { lng: string; lat: string; pano?: string } }>(
    "/info/panorama",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["lng", "lat"],
          properties: {
            lng: { type: "number", minimum: -180, maximum: 180 },
            lat: { type: "number", minimum: -90, maximum: 90 },
            pano: { type: "string", enum: ["1", "0"] }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        return await withRequestSignal(request, reply, (signal) =>
          streetPanorama(Number(request.query.lng), Number(request.query.lat), signal, {
            panoramasOnly: request.query.pano === "1"
          })
        );
      } catch {
        return reply.code(502).send({
          message: "Pohled z ulice se nepodařilo načíst. Zkus to znovu nebo otevři poskytovatele."
        });
      }
    }
  );
  app.get<{ Querystring: { lng: string; lat: string } }>(
    "/info/panorama/panoramax",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["lng", "lat"],
          properties: {
            lng: { type: "number", minimum: -180, maximum: 180 },
            lat: { type: "number", minimum: -90, maximum: 90 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        return await withRequestSignal(request, reply, (signal) =>
          panoramaxPanorama(Number(request.query.lng), Number(request.query.lat), signal)
        );
      } catch {
        return reply.code(502).send({ message: "Panoramax se nepodařilo načíst." });
      }
    }
  );
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
    Querystring: {
      lng?: string;
      lat?: string;
      name?: string;
      category?: string;
      qid?: string;
      layerId?: string;
      layerName?: string;
      facts?: string;
      web?: string;
    };
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
      // Legacy clients may send unverified names/facts. Never classify these as public data,
      // perform a web search or generate automatically. Canonical research uses /v2/ai/overview.
      return reply.header("cache-control", "private, no-store").send({
        text: `Vybraný bod: ${lat.toFixed(4)}, ${lng.toFixed(4)}. Identita místa zatím není ověřená.`,
        model: null,
        nearby: [],
        citations: [],
        attribution: "Souřadnice vybraného bodu",
        generation: { status: "unavailable", profileId: null, cached: false },
        freshness: { collectedAt: new Date().toISOString() }
      });
    }
  );

  app.get<{ Querystring: { fsqId?: string; name?: string; lng?: string; lat?: string } }>(
    "/info/foursquare",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            fsqId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            lng: { type: "string", maxLength: 24 },
            lat: { type: "string", maxLength: 24 }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const { fsqId, name, lng, lat } = request.query;
      if (
        !fsqId &&
        (!name?.trim() ||
          !lng?.trim() ||
          !lat?.trim() ||
          !Number.isFinite(Number(lng)) ||
          !Number.isFinite(Number(lat)) ||
          Math.abs(Number(lng)) > 180 ||
          Math.abs(Number(lat)) > 90)
      ) {
        return reply.code(400).send({ message: "Zadejte identitu nebo název a polohu místa." });
      }
      try {
        const result = await withRequestSignal(request, reply, async (signal) =>
          fsqId
            ? foursquarePlaces.detail(fsqId, signal)
            : {
                candidates: await foursquarePlaces.search(
                  { name: name!, lng: Number(lng), lat: Number(lat) },
                  signal
                )
              }
        );
        if (!result) return reply.code(404).send({ message: "Místo nebylo nalezeno." });
        return result;
      } catch (error) {
        if (error instanceof ProviderBudgetError)
          return reply
            .code(error.code === "budget-exhausted" ? 429 : 503)
            .send({ code: error.code, message: error.message });
        throw error;
      }
    }
  );

  // Population for a drawn area (§8). The numeric half of the population story: the map may draw
  // a raster, but "how many people live here" is a provider computation, not a pixel sum.
  app.get<{ Querystring: { bbox?: string; year?: string } }>(
    "/info/population/area",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            bbox: { type: "string", maxLength: 120 },
            year: { type: "string", maxLength: 4 }
          }
        }
      }
    },
    async (request, reply) => {
      const values = (request.query.bbox ?? "").split(",").map((value) => Number(value.trim()));
      if (values.length !== 4 || !values.every(Number.isFinite)) {
        return reply.code(400).send({ message: "bbox musí být west,south,east,north" });
      }
      const [west, south, east, north] = values as [number, number, number, number];
      if (
        west < -180 ||
        east > 180 ||
        south < -90 ||
        north > 90 ||
        west >= east ||
        south >= north
      ) {
        return reply.code(400).send({ message: "bbox musí být west,south,east,north" });
      }
      // A continent is many WorldPop tasks; keep the drawn area to something a city answers.
      if (east - west > 5 || north - south > 5) {
        return reply.code(422).send({ message: "Pro součet populace vyber menší oblast." });
      }
      const year = request.query.year ? Number(request.query.year) : undefined;
      try {
        const result = await withRequestSignal(request, reply, (signal) =>
          areaPopulation([west, south, east, north], { year, signal })
        );
        return reply.header("cache-control", "private, max-age=3600").send(result);
      } catch {
        return reply.code(502).send({ message: "Součet populace se nepodařilo načíst." });
      }
    }
  );
}
