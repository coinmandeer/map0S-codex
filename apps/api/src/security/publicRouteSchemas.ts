import type { FastifyInstance, FastifySchema } from "fastify";

const SAFE_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  maxProperties: 0,
  additionalProperties: false
} as const;

const BOUNDED_STRING_OR_ARRAY = {
  anyOf: [
    { type: "string", maxLength: 2_048 },
    {
      type: "array",
      maxItems: 50,
      items: { type: "string", maxLength: 2_048 }
    },
    { type: "number" },
    { type: "boolean" }
  ]
} as const;

const BOUNDED_PARAMS_SCHEMA = {
  type: "object",
  maxProperties: 12,
  propertyNames: { maxLength: 80 },
  additionalProperties: BOUNDED_STRING_OR_ARRAY
} as const;

const BOUNDED_QUERY_SCHEMA = {
  type: "object",
  maxProperties: 32,
  propertyNames: { maxLength: 80 },
  additionalProperties: BOUNDED_STRING_OR_ARRAY
} as const;

const BOUNDED_BODY_SCHEMA = {
  anyOf: [
    {
      type: "object",
      maxProperties: 64,
      propertyNames: { maxLength: 120 },
      additionalProperties: true
    },
    { type: "array", maxItems: 500 },
    { type: "string", maxLength: 1024 * 1024 },
    { type: "number" },
    { type: "boolean" },
    { type: "null" }
  ]
} as const;

/**
 * Legacy GETs proven to have no params or query input. Keeping this list explicit means a new
 * no-input exception cannot appear silently; all other legacy routes receive finite generic
 * params/query envelopes until their domain-specific schema is introduced.
 */
export const LEGACY_INPUT_FREE_GET_ROUTES = [
  "/v2/me/saved-place-collections",
  "/auth/me",
  "/config",
  "/drafts",
  "/follows",
  "/game/progress",
  "/health",
  "/layers",
  "/plans",
  "/user-layers",
  "/v2/events/sources",
  "/weather/frames"
] as const;

const inputFree = new Set<string>(LEGACY_INPUT_FREE_GET_ROUTES);

function methods(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).map((method) => method.toUpperCase());
}

/**
 * Gives every production route a finite Fastify input contract. Exact route schemas win; this
 * guard only fills missing input surfaces and caps legacy request bodies at Fastify's parser.
 */
export function installBoundedPublicRouteSchemas(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const routeMethods = methods(route.method);
    const readOnly = routeMethods.every((method) => SAFE_READ_METHODS.has(method));
    const noInputLegacyGet = readOnly && inputFree.has(route.url);
    const schema = { ...(route.schema ?? {}) } as FastifySchema;

    if (!schema.params) {
      schema.params = route.url.includes(":") ? BOUNDED_PARAMS_SCHEMA : EMPTY_OBJECT_SCHEMA;
    }
    if (!schema.querystring) {
      schema.querystring = noInputLegacyGet ? EMPTY_OBJECT_SCHEMA : BOUNDED_QUERY_SCHEMA;
    }
    if (!readOnly && !schema.body) {
      schema.body = BOUNDED_BODY_SCHEMA;
    }

    route.schema = schema;
    if (!readOnly) {
      route.bodyLimit ??= 1024 * 1024;
    }
  });
}
