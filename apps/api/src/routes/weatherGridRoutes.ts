/** Open-Meteo weather grid routes. Registered on both servers because they need no API key,
 *  so the Windy-style overlays are fully live in e2e runs too. */

import type { FastifyInstance } from "fastify";
import type { Bbox } from "@mapos/layer-sdk";
import {
  fetchWeatherGrid,
  isWeatherVariable,
  WEATHER_VARIABLES,
  type WeatherVariableId
} from "../services/weatherGridService.js";

function parseBbox(raw: string | undefined): Bbox | null {
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  maxProperties: 0,
  additionalProperties: false
} as const;

export function registerWeatherGridRoutes(app: FastifyInstance) {
  app.get(
    "/weather/variables",
    { schema: { params: EMPTY_OBJECT_SCHEMA, querystring: EMPTY_OBJECT_SCHEMA } },
    async () => ({
      variables: (Object.keys(WEATHER_VARIABLES) as WeatherVariableId[]).map((id) => ({
        id,
        label: WEATHER_VARIABLES[id].label,
        unit: WEATHER_VARIABLES[id].unit,
        vector: Boolean(WEATHER_VARIABLES[id].vector)
      }))
    })
  );

  app.get<{
    Querystring: { bbox?: string; variable?: string; cols?: string; rows?: string; at?: string };
  }>(
    "/weather/grid",
    {
      schema: {
        params: EMPTY_OBJECT_SCHEMA,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["bbox"],
          properties: {
            bbox: {
              type: "string",
              minLength: 7,
              maxLength: 100,
              pattern: "^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$"
            },
            variable: { type: "string", enum: Object.keys(WEATHER_VARIABLES) },
            cols: { type: "string", pattern: "^[0-9]{1,3}$" },
            rows: { type: "string", pattern: "^[0-9]{1,3}$" },
            at: { type: "string", minLength: 4, maxLength: 40 }
          }
        }
      }
    },
    async (request, reply) => {
      const bbox = parseBbox(request.query.bbox);
      if (!bbox) return reply.code(400).send({ message: "bbox required as w,s,e,n" });

      const variable = request.query.variable ?? "wind";
      if (!isWeatherVariable(variable)) {
        return reply.code(400).send({ message: `unknown variable ${variable}` });
      }

      try {
        const grid = await fetchWeatherGrid({
          bbox,
          variable,
          cols: request.query.cols ? Number(request.query.cols) : undefined,
          rows: request.query.rows ? Number(request.query.rows) : undefined,
          at: request.query.at
        });
        return reply.header("cache-control", "public, max-age=900").send(grid);
      } catch {
        return reply.code(502).send({ message: "weather grid unavailable" });
      }
    }
  );
}
