import { statisticsReport } from "../themes/statisticsReport.js";
import { themeGroup } from "../themes/themeRegistry.js";
import {
  explorerInventory,
  explorerRows,
  catalogCoverage
} from "../themes/themeExplorerService.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { higherIsWorse, themeText } from "@mapos/layer-sdk";
import {
  listThemes,
  themeMetadata,
  themeSources,
  themeTile,
  themeUnit,
  type ThemeQueries
} from "../themes/themeService.js";

/**
 * The three requests a thematic overlay makes.
 *
 * `GET /v2/themes` is the switch list, `GET /v2/themes/:id` is everything the legend needs, and
 * the tile route is the composite endpoint from §23.5 — one URL per theme, with the server
 * choosing which dataset answers at the requested zoom.
 *
 * Tiles are cached hard and metadata is not. A boundary and a year-old statistic do not change,
 * so a tile can sit in a CDN for a day; the metadata carries the list of available periods,
 * which changes the moment an import finishes.
 */
const TILE_PARAMS = {
  type: "object",
  required: ["id", "z", "x", "y"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9-]{1,40}$" },
    z: { type: "integer", minimum: 0, maximum: 14 },
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 }
  }
} as const;

const LANG_PROPERTY = {
  /** Which language the reader-facing strings come back in. Codes and numbers never change. */
  lang: { type: "string", enum: ["en", "cs"] }
} as const;

const PERIOD_QUERY = {
  type: "object",
  properties: {
    zoom: { type: "number", minimum: 0, maximum: 24 },
    period: { type: "string", maxLength: 16, pattern: "^(latest|[0-9][0-9A-Za-z-]{0,15})$" },
    /** Comma-separated dataset ids the user switched off in the sources popover. */
    exclude: { type: "string", maxLength: 400 },
    ...LANG_PROPERTY
  }
} as const;

function localeFrom(query: unknown): string {
  return (query as { lang?: string }).lang ?? "en";
}

const BBOX_QUERY = {
  type: "object",
  required: ["bbox"],
  properties: { bbox: { type: "string", maxLength: 120 } }
} as const;

function excludedFrom(query: unknown): string[] {
  const raw = (query as { exclude?: string }).exclude;
  return raw
    ? raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
}

/** `west,south,east,north` in degrees, or null when the client sent something unusable. */
function parseBbox(raw: string): [number, number, number, number] | null {
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return [west, south, east, north];
}

export function registerThemeRoutes(
  app: FastifyInstance,
  options: { queries?: ThemeQueries } = {}
) {
  const queries = options.queries;
  app.get("/v2/themes/operations", async () => (queries ? { datasets: [] } : statisticsReport()));

  app.get(
    "/v2/themes",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            ...LANG_PROPERTY,
            zoom: { type: "number", minimum: 0, maximum: 24 },
            bbox: { type: "string", maxLength: 120 }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBbox = (request.query as { bbox?: string }).bbox;
      const bbox = rawBbox ? parseBbox(rawBbox) : null;
      if (rawBbox && !bbox) return reply.code(400).send({ code: "bbox-invalid" });
      const coverage = queries
        ? {}
        : await catalogCoverage(bbox, (request.query as { zoom?: number }).zoom);
      const locale = localeFrom(request.query);
      // The same for every reader; the client snaps its bbox, so a pan back hits the browser.
      reply.header("Cache-Control", "public, max-age=300");
      return {
        themes: listThemes().map((entry) => {
          const text = themeText(entry, locale);
          return {
            id: entry.id,
            group: themeGroup(entry.id),
            name: text.name,
            icon: entry.icon ?? "bar_chart",
            unit: text.unit,
            higherIsWorse: higherIsWorse(entry),
            ...(text.disclosure ? { disclosure: text.disclosure } : {}),
            sourceCount: entry.sources.length,
            ...coverage[entry.id]
          };
        })
      };
    }
  );

  app.get(
    "/v2/themes/:id",
    { schema: { querystring: PERIOD_QUERY } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { period, zoom } = request.query as { period?: string; zoom?: number };
      const excluded = excludedFrom(request.query);
      const locale = localeFrom(request.query);
      const metadata = queries
        ? await themeMetadata(id, period, queries, excluded, locale, zoom)
        : await themeMetadata(id, period, undefined, excluded, locale, zoom);
      // A stable `code` next to the message: the client owns the wording, in whichever
      // language the reader chose, and the server owns what went wrong.
      if (!metadata) return reply.code(404).send({ code: "theme-unknown" });
      const inventory = queries ? null : await explorerInventory(id, excluded, period ?? "latest");
      return inventory
        ? { ...metadata, ...inventory, ready: metadata.ready && inventory.ready }
        : metadata;
    }
  );

  app.get(
    "/v2/themes/:id/rows",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            ...PERIOD_QUERY.properties,
            bbox: { type: "string", maxLength: 120 },
            offset: { type: "integer", minimum: 0, maximum: 100000 },
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!listThemes().some((t) => t.id === id))
        return reply.code(404).send({ code: "theme-unknown" });
      if (queries) return { rows: [], total: 0 };
      const q = request.query as {
        period?: string;
        offset?: number;
        limit?: number;
        zoom?: number;
        bbox?: string;
      };
      const bbox = q.bbox ? parseBbox(q.bbox) : undefined;
      if (q.bbox && !bbox) return reply.code(400).send({ code: "bbox-invalid" });
      const metadata = await themeMetadata(
        id,
        q.period ?? "latest",
        undefined,
        excludedFrom(request.query),
        "en",
        q.zoom
      );
      if (!metadata?.selectedDatasetId) return { rows: [], total: 0 };
      return explorerRows(
        id,
        q.period ?? "latest",
        excludedFrom(request.query),
        q.offset ?? 0,
        q.limit ?? 200,
        metadata.selectedDatasetId,
        bbox ?? undefined
      );
    }
  );

  app.get(
    "/v2/themes/:id/sources",
    { schema: { querystring: BBOX_QUERY } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const entry = listThemes().find((candidate) => candidate.id === id);
      if (!entry) return reply.code(404).send({ code: "theme-unknown" });

      const bbox = parseBbox((request.query as { bbox: string }).bbox);
      if (!bbox) return reply.code(400).send({ code: "bbox-invalid" });

      const covering = await themeSources(id, bbox, queries);
      // Coverage says how much of the view a source answers for; the manifest says what it is
      // called and who to credit. The popover needs both in one row, so they are joined here
      // rather than leaving the client to correlate two lists.
      return { sources: covering };
    }
  );

  app.get(
    "/v2/themes/:id/units/:level/:code",
    { schema: { querystring: PERIOD_QUERY } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, level, code } = request.params as {
        id: string;
        level: string;
        code: string;
      };
      const { period } = request.query as { period?: string; zoom?: number };
      const locale = localeFrom(request.query);
      const detail = queries
        ? await themeUnit(id, level, code, period, queries, excludedFrom(request.query), locale)
        : await themeUnit(id, level, code, period, undefined, excludedFrom(request.query), locale);
      // 404 covers both "no such theme" and "no such territory in this series": from the
      // client's side they are the same thing — there is nothing to show for what was clicked.
      if (!detail) return reply.code(404).send({ code: "theme-unit-empty" });
      return detail;
    }
  );

  app.get(
    "/v2/themes/:id/tiles/:z/:x/:y.pbf",
    { schema: { params: TILE_PARAMS, querystring: PERIOD_QUERY } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, z, x, y } = request.params as { id: string; z: number; x: number; y: number };
      const { period, zoom } = request.query as { period?: string; zoom?: number };
      const excluded = excludedFrom(request.query);
      // `2 ** z` tiles per axis: an out-of-range coordinate is a client bug, and answering it
      // with an empty tile would hide it.
      const limit = 2 ** z;
      if (x >= limit || y >= limit) {
        return reply.code(400).send({ code: "tile-out-of-range" });
      }

      const tile = queries
        ? await themeTile(id, z, x, y, period, queries, excluded, zoom)
        : await themeTile(id, z, x, y, period, undefined, excluded, zoom);
      // 204 rather than an empty body with 200: MapLibre treats both as "nothing here", and the
      // status makes "no data imported yet" visible in the network panel instead of looking
      // like a corrupt tile.
      if (!tile || tile.byteLength === 0) return reply.code(204).send();

      reply.header("content-type", "application/vnd.mapbox-vector-tile");
      reply.header("cache-control", "public, max-age=300");
      return reply.send(Buffer.from(tile));
    }
  );
}
