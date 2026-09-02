import { assertCompatibleSchema } from "./common.js";
import type { MapOSFeatureV2 } from "./feature.js";
import type {
  DeclarativeHttpMappingV2,
  DeclarativeHttpQueryValueV2,
  LayerManifestV2,
  LayerSourceV2
} from "./layer.js";
import type { FeatureQueryResultV2 } from "./query.js";
import { FEATURE_QUERY_MAX_LIMIT } from "./query.js";
import type { TaskRecordV2, TaskStatusV2, TaskTypeV2 } from "./task.js";
import { assertLayerManifestSchemaV2 } from "./layerManifestValidation.js";

const TASK_TYPES: ReadonlySet<TaskTypeV2> = new Set([
  "layer-query",
  "tile-load",
  "geocode",
  "reverse-geocode",
  "routing",
  "weather",
  "event-search",
  "ai",
  "poi-enrichment",
  "import",
  "export",
  "sync",
  "game-asset",
  "commerce"
]);
const TASK_STATUSES: ReadonlySet<TaskStatusV2> = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "stale"
]);
const TASK_CACHE_STATES = new Set(["unknown", "none", "hit", "miss", "mixed"]);
const SAFE_CORRELATION_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_REQUEST_KEY = /^rk_[a-f0-9]{16,64}$/;
const TASK_TELEMETRY_FIELDS = new Set([
  "durationMs",
  "aborted",
  "cache",
  "providerId",
  "source",
  "budget",
  "received",
  "eligibleSegments",
  "providerCalls",
  "cacheHits",
  "maxConcurrency",
  "failedSegments"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${field} is required.`);
}

const SAFE_DATA_PATH = /^(?:[A-Za-z_][A-Za-z0-9_-]*)(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*))*$/;
const DECLARATIVE_QUERY_VALUES = new Set<DeclarativeHttpQueryValueV2>([
  "bbox",
  "west",
  "south",
  "east",
  "north",
  "limit",
  "cursor",
  "zoom"
]);

function safeDataPath(value: unknown, field: string, optional = false): void {
  if (optional && value === undefined) return;
  requiredString(value, field);
  if (
    !SAFE_DATA_PATH.test(value) ||
    value.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))
  ) {
    throw new TypeError(`${field} must be a safe dot path.`);
  }
}

/** Runtime guard for the untrusted L1 connector boundary. */
export function assertDeclarativeHttpSourceV2(value: unknown): asserts value is LayerSourceV2 & {
  type: "declarative-http";
  endpoint: string;
  requiresServerProxy: true;
  mapping: DeclarativeHttpMappingV2;
} {
  if (!record(value) || value.type !== "declarative-http") {
    throw new TypeError("source.type must be declarative-http.");
  }
  requiredString(value.endpoint, "source.endpoint");
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new TypeError("source.endpoint must be an absolute URL.");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    (endpoint.port && endpoint.port !== "443")
  ) {
    throw new TypeError("source.endpoint must be credential-free HTTPS on the default port.");
  }
  if ((value.method ?? "GET") !== "GET") {
    throw new TypeError("Declarative HTTP v2 initially supports GET only.");
  }
  if (value.requiresServerProxy !== true) {
    throw new TypeError("Declarative HTTP sources must require the MapOS server proxy.");
  }
  if (value.responseAdapter !== undefined) {
    throw new TypeError("Declarative HTTP sources cannot name executable response adapters.");
  }
  if (value.authRef !== undefined && !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(value.authRef))) {
    throw new TypeError("source.authRef must be an opaque reference name.");
  }
  if (
    value.timeoutMs !== undefined &&
    (!Number.isInteger(value.timeoutMs) ||
      Number(value.timeoutMs) < 100 ||
      Number(value.timeoutMs) > 10_000)
  ) {
    throw new TypeError("source.timeoutMs must be between 100 and 10000.");
  }
  if (
    value.maxResponseBytes !== undefined &&
    (!Number.isInteger(value.maxResponseBytes) ||
      Number(value.maxResponseBytes) < 1_024 ||
      Number(value.maxResponseBytes) > 2_097_152)
  ) {
    throw new TypeError("source.maxResponseBytes must be between 1024 and 2097152.");
  }
  if (value.query !== undefined) {
    if (!record(value.query) || Object.keys(value.query).length > 24) {
      throw new TypeError("source.query must contain at most 24 fixed mappings.");
    }
    for (const [key, queryValue] of Object.entries(value.query)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
        throw new TypeError("source.query contains an unsafe parameter name.");
      }
      if (
        typeof queryValue !== "string" ||
        (!DECLARATIVE_QUERY_VALUES.has(queryValue as DeclarativeHttpQueryValueV2) &&
          !/^filter:[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(queryValue))
      ) {
        throw new TypeError(`source.query.${key} has an unsupported value mapping.`);
      }
    }
  }
  if (!record(value.mapping)) throw new TypeError("source.mapping is required.");
  safeDataPath(value.mapping.itemsPath, "source.mapping.itemsPath", true);
  safeDataPath(value.mapping.idPath, "source.mapping.idPath");
  safeDataPath(value.mapping.titlePath, "source.mapping.titlePath");
  safeDataPath(value.mapping.categoryPath, "source.mapping.categoryPath", true);
  safeDataPath(value.mapping.longitudePath, "source.mapping.longitudePath");
  safeDataPath(value.mapping.latitudePath, "source.mapping.latitudePath");
  safeDataPath(value.mapping.summaryPath, "source.mapping.summaryPath", true);
  safeDataPath(value.mapping.descriptionPath, "source.mapping.descriptionPath", true);
  safeDataPath(value.mapping.sourceIdPath, "source.mapping.sourceIdPath", true);
  safeDataPath(value.mapping.nextCursorPath, "source.mapping.nextCursorPath", true);
}

export function assertMapOSFeatureV2(value: unknown): asserts value is MapOSFeatureV2 {
  if (!record(value)) throw new TypeError("MapOS feature must be an object.");
  requiredString(value.schema, "schema");
  requiredString(value.schemaVersion, "schemaVersion");
  assertCompatibleSchema(
    { schema: value.schema, schemaVersion: value.schemaVersion },
    "mapos.feature"
  );
  requiredString(value.id, "id");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) {
    throw new TypeError("revision must be a positive integer.");
  }
  if (!record(value.geometry) || typeof value.geometry.type !== "string") {
    throw new TypeError("geometry is required.");
  }
  if (!record(value.properties)) throw new TypeError("properties are required.");
  requiredString(value.properties.title, "properties.title");
  requiredString(value.properties.category, "properties.category");
  if (!Array.isArray(value.properties.layerIds) || value.properties.layerIds.length === 0) {
    throw new TypeError("properties.layerIds must not be empty.");
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new TypeError("sources must not be empty.");
  }
  if (!record(value.access)) throw new TypeError("access is required.");
  requiredString(value.createdAt, "createdAt");
  requiredString(value.updatedAt, "updatedAt");
}

export function assertLayerManifestV2(value: unknown): asserts value is LayerManifestV2 {
  assertLayerManifestSchemaV2(value);
}

export function assertFeatureQueryResultV2(value: unknown): asserts value is FeatureQueryResultV2 {
  if (!record(value) || !record(value.data) || !record(value.meta)) {
    throw new TypeError("Feature query result is invalid.");
  }
  if (value.data.type !== "FeatureCollection" || !Array.isArray(value.data.features)) {
    throw new TypeError("Feature query data must be a FeatureCollection.");
  }
  if (
    !Number.isInteger(value.meta.limit) ||
    Number(value.meta.limit) < 1 ||
    Number(value.meta.limit) > FEATURE_QUERY_MAX_LIMIT
  ) {
    throw new TypeError(`meta.limit must be between 1 and ${FEATURE_QUERY_MAX_LIMIT}.`);
  }
  if (value.data.features.length > Number(value.meta.limit)) {
    throw new TypeError("Feature query returned more features than its limit.");
  }
  for (const feature of value.data.features) assertMapOSFeatureV2(feature);
  if (!Array.isArray(value.notices)) throw new TypeError("notices must be an array.");
}

export function assertTaskRecordV2(value: unknown): asserts value is TaskRecordV2 {
  if (!record(value)) throw new TypeError("Task record must be an object.");
  requiredString(value.schema, "schema");
  requiredString(value.schemaVersion, "schemaVersion");
  assertCompatibleSchema(
    { schema: value.schema, schemaVersion: value.schemaVersion },
    "mapos.task"
  );
  requiredString(value.id, "id");
  requiredString(value.label, "label");
  if (!TASK_TYPES.has(value.type as TaskTypeV2)) throw new TypeError("type is not supported.");
  if (!TASK_STATUSES.has(value.status as TaskStatusV2))
    throw new TypeError("status is not supported.");
  requiredString(value.startedAt, "startedAt");
  if (Number.isNaN(Date.parse(value.startedAt)))
    throw new TypeError("startedAt must be a date-time.");
  if (
    value.finishedAt != null &&
    (typeof value.finishedAt !== "string" || Number.isNaN(Date.parse(value.finishedAt)))
  ) {
    throw new TypeError("finishedAt must be a date-time or null.");
  }
  if (typeof value.cancellable !== "boolean") throw new TypeError("cancellable is required.");
  if (
    value.progress != null &&
    (typeof value.progress !== "number" || value.progress < 0 || value.progress > 1)
  ) {
    throw new TypeError("progress must be between 0 and 1.");
  }
  if (
    value.requestKey != null &&
    (typeof value.requestKey !== "string" || !SAFE_REQUEST_KEY.test(value.requestKey))
  ) {
    throw new TypeError("requestKey must be null or an opaque rk_ digest.");
  }
  if (value.telemetry !== undefined) {
    if (!record(value.telemetry)) throw new TypeError("telemetry must be an object.");
    for (const key of Object.keys(value.telemetry)) {
      if (!TASK_TELEMETRY_FIELDS.has(key)) {
        throw new TypeError(`telemetry.${key} is not supported.`);
      }
    }
    for (const field of [
      "budget",
      "received",
      "eligibleSegments",
      "providerCalls",
      "cacheHits",
      "maxConcurrency",
      "failedSegments"
    ]) {
      const item = value.telemetry[field];
      if (item !== undefined && (!Number.isInteger(item) || Number(item) < 0)) {
        throw new TypeError(`telemetry.${field} must be a non-negative integer.`);
      }
    }
    if (
      value.telemetry.durationMs !== undefined &&
      (typeof value.telemetry.durationMs !== "number" || value.telemetry.durationMs < 0)
    ) {
      throw new TypeError("telemetry.durationMs must be a non-negative number.");
    }
    if (value.telemetry.aborted !== undefined && typeof value.telemetry.aborted !== "boolean") {
      throw new TypeError("telemetry.aborted must be a boolean.");
    }
    if (
      value.telemetry.cache !== undefined &&
      !TASK_CACHE_STATES.has(String(value.telemetry.cache))
    ) {
      throw new TypeError("telemetry.cache is not supported.");
    }
    if (
      value.telemetry.providerId != null &&
      (typeof value.telemetry.providerId !== "string" ||
        !SAFE_PROVIDER_ID.test(value.telemetry.providerId))
    ) {
      throw new TypeError("telemetry.providerId is not a safe provider identifier.");
    }
    if (
      value.telemetry.source != null &&
      (typeof value.telemetry.source !== "string" || !SAFE_PROVIDER_ID.test(value.telemetry.source))
    ) {
      throw new TypeError("telemetry.source is not a safe provider identifier.");
    }
  }
  if (value.correlation !== undefined && value.correlation !== null) {
    if (!record(value.correlation)) throw new TypeError("correlation must be an object or null.");
    for (const key of Object.keys(value.correlation)) {
      if (key !== "requestId" && key !== "providerId") {
        throw new TypeError(`correlation.${key} is not supported.`);
      }
    }
    if (
      typeof value.correlation.requestId !== "string" ||
      !SAFE_CORRELATION_ID.test(value.correlation.requestId)
    ) {
      throw new TypeError("correlation.requestId is not a safe request identifier.");
    }
    if (
      typeof value.correlation.providerId !== "string" ||
      !SAFE_PROVIDER_ID.test(value.correlation.providerId)
    ) {
      throw new TypeError("correlation.providerId is not a safe provider identifier.");
    }
  }
}
