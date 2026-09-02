import type { FastifyInstance } from "fastify";

const WEATHER_VARIABLES = {
  temperature: { label: "Teplota", unit: "°C", vector: false, value: 17 },
  precipitation: { label: "Srážky", unit: "mm", vector: false, value: 0 },
  wind: { label: "Vítr", unit: "m/s", vector: true, value: 3 },
  gusts: { label: "Nárazy", unit: "m/s", vector: false, value: 5 },
  clouds: { label: "Oblačnost", unit: "%", vector: false, value: 28 },
  pressure: { label: "Tlak", unit: "hPa", vector: false, value: 1016 },
  humidity: { label: "Vlhkost", unit: "%", vector: false, value: 58 }
} as const;

type WeatherVariable = keyof typeof WEATHER_VARIABLES;

function parseBbox(raw: string | undefined): [number, number, number, number] | null {
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function fixedForecast() {
  const hours = Array.from({ length: 8 }, (_, index) => ({
    time: `2026-09-01T${String(12 + index).padStart(2, "0")}:00`,
    temperature: 17 + (index % 3),
    precipitation: 0,
    code: 1
  }));
  return {
    current: { temperature: 18, windSpeed: 11, windDirection: 245, code: 1 },
    hourly: hours,
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      min: 12 + (index % 2),
      max: 21 + (index % 3),
      precipitation: index === 1 ? 0.4 : 0,
      code: index === 1 ? 2 : 1
    })),
    source: {
      id: "offline-fixture",
      label: "MapOS offline weather fixture",
      url: null,
      license: "synthetic test data"
    },
    climate: {
      status: "unavailable",
      normals: [],
      extremes: [],
      source: null,
      gate: "climate-provider-not-configured",
      reason: "Offline fixture neobsahuje klimatické normály ani historické extrémy."
    }
  };
}

/**
 * Recorded/synthetic replacements for every shared route that normally talks to an upstream.
 * This registrar is used only when MAPOS_FIXTURE_MODE=offline; the default memory and production
 * compositions keep their existing provider-backed behavior.
 */
export function registerOfflineFixtureRoutes(app: FastifyInstance) {
  app.get("/mapy/attribution", async () => ({
    attribution: "© Seznam.cz, a.s. — offline fixture",
    logoUrl: "",
    enabled: false
  }));

  app.get("/mapy/tiles/:mapset/:z/:x/:y", async (_request, reply) =>
    reply.code(503).send({ message: "Mapy.com není v offline fixture režimu dostupné" })
  );
  app.get<{ Querystring: { q?: string } }>("/mapy/geocode", async (request) => ({
    results:
      (request.query.q ?? "").trim().length < 2
        ? []
        : [
            {
              name: "Plzeň",
              label: "Plzeň — offline fixture",
              location: "Česko",
              position: { lon: 13.3775, lat: 49.7475 },
              type: "regional"
            }
          ]
  }));
  app.get<{ Querystring: { q?: string } }>("/mapy/suggest", async (request) => ({
    results:
      (request.query.q ?? "").trim().length < 2
        ? []
        : [
            {
              name: "Plzeň",
              label: "Plzeň — offline fixture",
              location: "Česko",
              position: { lon: 13.3775, lat: 49.7475 },
              type: "regional"
            }
          ]
  }));

  app.get("/basemap/:provider/:mapset/:z/:x/:y", async (_request, reply) =>
    reply.code(503).send({ message: "Basemap provider není v offline fixture režimu dostupný" })
  );

  app.get("/weather/variables", async () => ({
    variables: Object.entries(WEATHER_VARIABLES).map(([id, value]) => ({
      id,
      label: value.label,
      unit: value.unit,
      vector: value.vector
    }))
  }));
  app.get<{
    Querystring: { bbox?: string; variable?: string; cols?: string; rows?: string; at?: string };
  }>("/weather/grid", async (request, reply) => {
    const bbox = parseBbox(request.query.bbox);
    if (!bbox) return reply.code(400).send({ message: "bbox required as w,s,e,n" });
    const variable = request.query.variable ?? "wind";
    if (!(variable in WEATHER_VARIABLES)) {
      return reply.code(400).send({ message: `unknown variable ${variable}` });
    }

    const id = variable as WeatherVariable;
    const fixture = WEATHER_VARIABLES[id];
    const cols = Math.max(2, Math.min(12, Math.round(Number(request.query.cols)) || 4));
    const rows = Math.max(2, Math.min(12, Math.round(Number(request.query.rows)) || 3));
    const count = cols * rows;
    const values = Array.from({ length: count }, (_, index) =>
      Number((fixture.value + ((index % cols) - cols / 2) * 0.1).toFixed(2))
    );
    return reply.header("cache-control", "public, max-age=900").send({
      variable: id,
      label: fixture.label,
      unit: fixture.unit,
      bbox,
      cols,
      rows,
      values,
      ...(fixture.vector ? { u: values.map(() => -2.4), v: values.map(() => 1.8) } : {}),
      min: Math.min(...values),
      max: Math.max(...values),
      median: fixture.value,
      sampleCount: count,
      validAt: request.query.at ?? "2026-09-01T12:00:00.000Z",
      generatedAt: "2026-09-01T12:00:00.000Z"
    });
  });

  app.get<{ Querystring: { qid?: string; title?: string } }>(
    "/info/wikipedia",
    async (request, reply) => {
      if (!request.query.qid && !request.query.title) {
        return reply.code(400).send({ message: "qid or title required" });
      }
      return reply.code(404).send({ message: "Article not present in offline fixtures" });
    }
  );
  app.get<{ Querystring: { qid?: string } }>("/info/wikidata", async (request, reply) => {
    if (!request.query.qid?.trim()) return reply.code(400).send({ message: "qid required" });
    return reply.code(404).send({ message: "Entity not present in offline fixtures" });
  });
  app.get<{ Querystring: { lng?: string; lat?: string } }>(
    "/info/weather",
    async (request, reply) => {
      if (
        !Number.isFinite(Number(request.query.lng)) ||
        !Number.isFinite(Number(request.query.lat))
      ) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      return fixedForecast();
    }
  );
  app.get<{ Querystring: { url?: string } }>("/info/embeddable", async (request, reply) => {
    const url = request.query.url?.trim();
    if (!url) return reply.code(400).send({ message: "url required" });
    return {
      url,
      verdict: "blocked",
      reason: "Vkládání externího obsahu je v offline fixture režimu vypnuté."
    };
  });
  app.get<{ Querystring: { lng?: string; lat?: string } }>(
    "/info/geology",
    async (request, reply) => {
      if (
        !Number.isFinite(Number(request.query.lng)) ||
        !Number.isFinite(Number(request.query.lat))
      ) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      return reply.code(404).send({ message: "Geology not present in offline fixtures" });
    }
  );
  app.get<{ Querystring: { lng?: string; lat?: string; name?: string } }>(
    "/info/brief",
    async (request, reply) => {
      if (
        !Number.isFinite(Number(request.query.lng)) ||
        !Number.isFinite(Number(request.query.lat))
      ) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      return {
        text: `${request.query.name?.trim() || "Toto místo"} je součástí syntetické offline testovací oblasti.`,
        model: "offline-fixture",
        nearby: [],
        attribution: "MapOS offline fixture"
      };
    }
  );
  app.get<{ Querystring: { fsqId?: string } }>("/info/foursquare", async (request, reply) => {
    if (!request.query.fsqId?.trim()) return reply.code(400).send({ message: "fsqId required" });
    return reply.code(404).send({ message: "Venue not present in offline fixtures" });
  });

  app.get<{ Querystring: { bbox?: string; lang?: string; name?: string } }>(
    "/discover/guide",
    async (request, reply) => {
      const bbox = parseBbox(request.query.bbox);
      if (!bbox) return reply.code(400).send({ message: "bbox required" });
      const lng = (bbox[0] + bbox[2]) / 2;
      const lat = (bbox[1] + bbox[3]) / 2;
      return {
        area: request.query.name?.trim() || "Offline testovací oblast",
        lang: (request.query.lang ?? "cs").slice(0, 2),
        sourceId: "offline-fixture",
        attribution: "MapOS offline fixture",
        sections: [
          {
            id: "see",
            title: "Co vidět",
            intro: "Deterministický obsah bez přístupu k internetu.",
            items: [
              {
                name: "Testovací vyhlídka",
                lng,
                lat,
                description: "Syntetický bod pro E2E testy",
                sourceRef: "fixture:lookout"
              }
            ]
          }
        ]
      };
    }
  );
}
