import type { FastifyInstance } from "fastify";
import { WEATHER_MODELS, type WeatherModelId } from "../services/weatherGridService.js";

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

/** A valid 1×1 transparent PNG, so raster layers keep their normal MapLibre lifecycle offline. */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+T0YvWQAAAABJRU5ErkJggg==",
  "base64"
);

/** MapTiler weather variables, mirroring the live catalog so the provider toggle is exercisable
 *  offline. Frames are hourly and dated after the fixture clock so "nearest frame" is stable. */
const MAPTILER_WEATHER_VARIABLES = [
  ["temperature-2m:gfs", "Temperature", "c"],
  ["pressure-msl:gfs", "Pressure", "hPa"],
  ["precipitation-1h:gfs", "Precipitation", "mm"],
  ["wind-10m:gfs", "Wind", "ms"],
  ["radar-composite:gfs", "Radar", "dbz"]
] as const;

function maptilerFrames(): string[] {
  const base = Date.UTC(2026, 8, 17, 0, 0, 0);
  return Array.from({ length: 24 }, (_, index) => new Date(base + index * 3_600_000).toISOString());
}

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
      status: "ready",
      period: "1991-2020",
      normals: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        min: -3 + index,
        max: 2 + index * 2,
        samples: 30
      })),
      source: {
        id: "offline-fixture",
        label: "MapOS offline climate fixture",
        url: null,
        license: "synthetic test data"
      }
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
    Querystring: {
      bbox?: string;
      variable?: string;
      cols?: string;
      rows?: string;
      at?: string;
      model?: WeatherModelId;
    };
  }>("/weather/grid", async (request, reply) => {
    const bbox = parseBbox(request.query.bbox);
    if (!bbox) return reply.code(400).send({ message: "bbox required as w,s,e,n" });
    const variable = request.query.variable ?? "wind";
    const model = request.query.model ?? "best_match";
    if (!WEATHER_MODELS.includes(model))
      return reply.code(400).send({ message: "unknown weather model" });
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
      model,
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

  // MapTiler weather, offline: a catalog the provider toggle can read and proxy tiles that keep
  // the raster source's lifecycle without any upstream call.
  app.get("/weather/maptiler/catalog", async () => ({
    variables: MAPTILER_WEATHER_VARIABLES.map(([id, name, unit]) => ({
      id,
      name,
      unit,
      minzoom: 0,
      maxzoom: 3,
      frames: maptilerFrames()
    }))
  }));
  app.get<{
    Params: { variable: string; frame: string; z: string; x: string; yfile: string };
  }>("/weather/maptiler/:variable/:frame/:z/:x/:yfile", async (_request, reply) => {
    reply.type("image/png");
    return reply.send(TRANSPARENT_PNG);
  });

  // MeshCore nodes as a keyless data layer (§ keyless sources): points inside whatever bbox the
  // engine asked for, so the layer renders deterministically in an offline run.
  app.get<{ Querystring: { bbox?: string } }>("/layers/meshcore/features", async (request) => {
    const bbox = parseBbox(request.query.bbox) ?? [13, 49, 15, 51];
    const [west, south, east, north] = bbox;
    return {
      type: "FeatureCollection",
      features: Array.from({ length: 3 }, (_, index) => {
        const t = (index + 1) / 4;
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [west + (east - west) * t, south + (north - south) * t]
          },
          properties: {
            id: `meshcore:fixture-${index}`,
            name: `MeshCore ${index}`,
            layerId: "meshcore",
            category: "meshcore",
            role: "repeater",
            relayCount24h: 10 + index
          }
        };
      })
    };
  });

  app.get<{ Querystring: { lng?: string; lat?: string; radiusKm?: string } }>(
    "/game/quests/near",
    async (request, reply) => {
      const lng = Number(request.query.lng);
      const lat = Number(request.query.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return reply.code(400).send({ message: "lng and lat required" });
      }
      return {
        quests: [
          {
            id: "offline:quest:1",
            zoneId: null,
            title: "Prozkoumej okolí",
            description: "Syntetický quest pro offline testy.",
            rewardPoints: 25,
            lng,
            lat,
            sourceId: "offline-fixture",
            sourceLabel: "MapOS offline fixture",
            anchorName: "Offline kotva",
            distanceM: 120
          }
        ]
      };
    }
  );

  app.get<{ Querystring: { bbox?: string; year?: string } }>(
    "/info/population/area",
    async (request, reply) => {
      const values = (request.query.bbox ?? "").split(",").map((value) => Number(value.trim()));
      if (values.length !== 4 || !values.every(Number.isFinite)) {
        return reply.code(400).send({ message: "bbox musí být west,south,east,north" });
      }
      return {
        status: "ready",
        totalPopulation: 12345.6,
        unit: "people",
        year: 2020,
        dataset: "wpgppop",
        coverage: "global-land",
        source: {
          id: "worldpop",
          label: "WorldPop (wpgppop) — offline fixture",
          url: "https://www.worldpop.org/",
          license: "CC-BY-4.0",
          citation: "Offline fixture",
          resolution: "100 m grid"
        }
      };
    }
  );

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
  app.get<{
    Querystring: {
      lng?: string;
      lat?: string;
      name?: string;
      layerId?: string;
      layerName?: string;
      facts?: string;
    };
  }>("/info/brief", async (request, reply) => {
    if (
      !Number.isFinite(Number(request.query.lng)) ||
      !Number.isFinite(Number(request.query.lat))
    ) {
      return reply.code(400).send({ message: "lng and lat required" });
    }
    // The fixture echoes what made the request pin-specific, so a test can tell a summary of
    // this pin from a summary of its coordinates without reaching a model.
    const facts = request.query.facts?.split("|").filter(Boolean) ?? [];
    const layer = request.query.layerName?.trim() || request.query.layerId?.trim();
    return {
      text: [
        `${request.query.name?.trim() || "This place"} is part of a synthetic offline test area.`,
        layer ? `Layer: ${layer}.` : null,
        facts.length ? `Fields: ${facts.join(", ")}.` : null
      ]
        .filter(Boolean)
        .join(" "),
      model: "offline-fixture",
      nearby: [],
      attribution: "MapOS offline fixture",
      citations: [{ sourceId: "offline-fixture", label: "MapOS offline fixture" }]
    };
  });
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
