import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TerritoryLevel } from "@mapos/layer-sdk";
import { ClientError, safeErrorLogFields } from "../utils/clientError.js";
import {
  defaultTableIngestDeps,
  ingestTable,
  previewTable,
  refreshTable,
  TABLE_MAX_BYTES,
  tableDatasetId,
  type TableDefinition,
  type TableIngestDeps,
  type TableIngestResult,
  type TablePreview
} from "../themes/tableImport.js";
import { datasetMetadata, datasetTile, type ThemeQueries } from "../themes/themeService.js";

/**
 * Importing a table, and drawing what came out of it (§20.3).
 *
 * The preview step exists because detection is a guess. A table names its columns in whatever
 * way its publisher liked, so the server says "this looks like the code column and this like the
 * value" and the user confirms — the alternative is a map that is confidently joined on the
 * wrong field, which nothing downstream can notice.
 *
 * A table is uploaded as base64 rather than multipart: the ceiling is 5 MiB, every other write
 * route in MapOS takes JSON, and one encoding for the whole API is worth more than the third of
 * a megabyte the encoding costs.
 */

const REJECT_UNKNOWN_PROPERTY = { not: {} } as const;

const LEVELS = ["country", "nuts1", "nuts2", "nuts3", "lau"] as const;

const PREVIEW_BODY = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  properties: {
    /** Base64 of the file. One of `content` or `url` is required. */
    content: { type: "string", maxLength: 8 * 1024 * 1024 },
    filename: { type: "string", maxLength: 240 },
    url: { type: "string", minLength: 8, maxLength: 2048 }
  }
} as const;

const CREATE_BODY = {
  type: "object",
  additionalProperties: REJECT_UNKNOWN_PROPERTY,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    content: { type: "string", maxLength: 8 * 1024 * 1024 },
    filename: { type: "string", maxLength: 240 },
    url: { type: "string", minLength: 8, maxLength: 2048 },
    codeColumn: { type: "integer", minimum: 0, maximum: 4096 },
    valueColumn: { type: "integer", minimum: 0, maximum: 4096 },
    geoLevel: { enum: LEVELS },
    unit: { type: "string", maxLength: 80 },
    period: { type: "string", maxLength: 16, pattern: "^[0-9][0-9A-Za-z-]{0,15}$" },
    refreshIntervalMinutes: { type: "integer", minimum: 60, maximum: 60 * 24 * 30 }
  }
} as const;

const TILE_PARAMS = {
  type: "object",
  required: ["id", "z", "x", "y"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 },
    z: { type: "integer", minimum: 0, maximum: 14 },
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 }
  }
} as const;

export interface TableRouteDependencies {
  resolveUserId(request: FastifyRequest): Promise<string | null>;
  /** Overridden offline, where there is no Postgres and no upstream. */
  ingest?: TableIngestDeps;
  loadTable?(ownerId: string, id: string): Promise<TableDefinition | null>;
  listTables?(ownerId: string): Promise<TableDefinition[]>;
  queries?: ThemeQueries;
}

export function registerTableRoutes(
  app: FastifyInstance,
  dependencies: TableRouteDependencies
): void {
  const load = dependencies.loadTable ?? loadTableDefinition;
  const list = dependencies.listTables ?? listTableDefinitions;

  app.post<{ Body: { content?: string; filename?: string; url?: string } }>(
    "/v2/tables/preview",
    { schema: { body: PREVIEW_BODY } },
    async (request, reply) => {
      const userId = await dependencies.resolveUserId(request);
      if (!userId) return reply.code(401).send({ message: "Unauthorized" });
      try {
        const { bytes, filename } = await bytesFor(request.body, dependencies);
        const preview: TablePreview = previewTable(bytes, filename);
        return reply.header("cache-control", "private, no-store").send(preview);
      } catch (error) {
        return failure(reply, error);
      }
    }
  );

  app.get("/v2/tables", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = await dependencies.resolveUserId(request);
    if (!userId) return reply.code(401).send({ message: "Unauthorized" });
    const tables = await list(userId);
    return reply
      .header("cache-control", "private, no-store")
      .send({ tables: tables.map(describeTable) });
  });

  app.post<{
    Body: {
      name: string;
      content?: string;
      filename?: string;
      url?: string;
      codeColumn?: number;
      valueColumn?: number;
      geoLevel?: TerritoryLevel;
      unit?: string;
      period?: string;
      refreshIntervalMinutes?: number;
    };
  }>("/v2/tables", { schema: { body: CREATE_BODY } }, async (request, reply) => {
    const userId = await dependencies.resolveUserId(request);
    if (!userId) return reply.code(401).send({ message: "Unauthorized" });
    try {
      const body = request.body;
      const source = await bytesFor(body, dependencies, { allowUrlPassthrough: true });
      const result: TableIngestResult = await ingestTable(
        {
          ownerId: userId,
          name: body.name,
          ...(source.bytes.byteLength ? { bytes: source.bytes, filename: source.filename } : {}),
          ...(body.url ? { sourceUrl: body.url } : {}),
          ...(body.codeColumn !== undefined ? { codeColumn: body.codeColumn } : {}),
          ...(body.valueColumn !== undefined ? { valueColumn: body.valueColumn } : {}),
          ...(body.geoLevel ? { geoLevel: body.geoLevel } : {}),
          ...(body.unit ? { unit: body.unit } : {}),
          ...(body.period ? { period: body.period } : {}),
          ...(body.refreshIntervalMinutes !== undefined
            ? { refreshIntervalMinutes: body.refreshIntervalMinutes }
            : {})
        },
        dependencies.ingest
      );
      return reply
        .code(201)
        .header("cache-control", "private, no-store")
        .send({
          table: describeTable(result.definition),
          written: result.written,
          matched: result.matched,
          warnings: result.warnings
        });
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/v2/tables/:id/refresh", async (request, reply) => {
    const userId = await dependencies.resolveUserId(request);
    if (!userId) return reply.code(401).send({ message: "Unauthorized" });
    const definition = await load(userId, request.params.id);
    if (!definition) return reply.code(404).send({ message: "Tabulku neznáme." });
    try {
      const result = await refreshTable(definition, dependencies.ingest);
      return reply.header("cache-control", "private, no-store").send({
        table: describeTable(result.definition),
        written: result.written,
        matched: result.matched,
        warnings: result.warnings
      });
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>("/v2/tables/:id", async (request, reply) => {
    const userId = await dependencies.resolveUserId(request);
    if (!userId) return reply.code(401).send({ message: "Unauthorized" });
    const definition = await load(userId, request.params.id);
    if (!definition) return reply.code(404).send({ message: "Tabulku neznáme." });
    const metadata = await datasetMetadata(
      tableDatasetId(definition.id),
      definition.geoLevel,
      definition.period,
      dependencies.queries
    );
    return reply.header("cache-control", "private, no-store").send({
      table: describeTable(definition),
      ...metadata
    });
  });

  app.get<{ Params: { id: string; z: number; x: number; y: number } }>(
    "/v2/tables/:id/tiles/:z/:x/:y.pbf",
    { schema: { params: TILE_PARAMS } },
    async (request, reply) => {
      const userId = await dependencies.resolveUserId(request);
      if (!userId) return reply.code(401).send({ message: "Unauthorized" });
      const { id, z, x, y } = request.params;
      const definition = await load(userId, id);
      if (!definition) return reply.code(404).send({ message: "Tabulku neznáme." });
      const limit = 2 ** z;
      if (x >= limit || y >= limit) {
        return reply.code(400).send({ message: "Dlaždice je mimo rozsah zoomu." });
      }

      const tile = await datasetTile(
        {
          datasetId: tableDatasetId(definition.id),
          geoLevel: definition.geoLevel,
          period: definition.period,
          z,
          x,
          y
        },
        dependencies.queries
      );
      if (!tile || tile.byteLength === 0) return reply.code(204).send();
      reply.header("content-type", "application/vnd.mapbox-vector-tile");
      // Private, and short: a user's own table changes when they refresh it, and a shared cache
      // would serve one user's numbers to another.
      reply.header("cache-control", "private, max-age=60");
      return reply.send(Buffer.from(tile));
    }
  );
}

function describeTable(definition: TableDefinition) {
  return {
    id: definition.id,
    name: definition.name,
    datasetId: tableDatasetId(definition.id),
    geoLevel: definition.geoLevel,
    valueLabel: definition.valueLabel,
    unit: definition.unit,
    period: definition.period,
    sourceUrl: definition.sourceUrl,
    refreshIntervalMinutes: definition.refreshIntervalMinutes
  };
}

async function bytesFor(
  body: { content?: string; filename?: string; url?: string },
  dependencies: TableRouteDependencies,
  options: { allowUrlPassthrough?: boolean } = {}
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (body.content) {
    const bytes = new Uint8Array(Buffer.from(body.content, "base64"));
    if (!bytes.byteLength) throw new ClientError("Soubor je prázdný.", 400);
    if (bytes.byteLength > TABLE_MAX_BYTES)
      throw new ClientError("Tabulka je větší než 5 MiB.", 413);
    return { bytes, filename: body.filename ?? "table.csv" };
  }
  if (!body.url) throw new ClientError("Chybí soubor i odkaz na tabulku.", 400);
  // On create the URL is handed to the ingest, which stores it for refreshing; the preview has
  // nothing to store it in and fetches it here.
  if (options.allowUrlPassthrough) return { bytes: new Uint8Array(), filename: "" };
  const fetcher = dependencies.ingest?.fetchTable ?? defaultTableIngestDeps.fetchTable;
  return fetcher(body.url);
}

async function loadTableDefinition(ownerId: string, id: string): Promise<TableDefinition | null> {
  const { tableDefinitionById } = await import("../themes/tableRepository.js");
  return tableDefinitionById(ownerId, id);
}

async function listTableDefinitions(ownerId: string): Promise<TableDefinition[]> {
  const { tableDefinitionsForOwner } = await import("../themes/tableRepository.js");
  return tableDefinitionsForOwner(ownerId);
}

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof ClientError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  if (error instanceof TypeError) {
    // The table parsers throw `TypeError` with a message written for the person who uploaded the
    // file — "we found no column with a territory code" is the answer, not a 500.
    return reply.code(400).send({ message: error.message });
  }
  reply.log.error(safeErrorLogFields(error), "table request failed");
  return reply.code(500).send({ message: "Tabulku se nepodařilo zpracovat." });
}
