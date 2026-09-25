import type { FastifyReply, FastifyRequest } from "fastify";

export function exactCorsOriginPolicy(origins: readonly string[]) {
  const allowed = new Set(origins);
  return (
    requestOrigin: string | undefined,
    done: (error: Error | null, origin: string | false) => void
  ) => {
    // Returning false disables the plugin for this request entirely, including the credentials
    // header. Returning the already-validated literal avoids reflecting arbitrary input.
    done(null, requestOrigin && allowed.has(requestOrigin) ? requestOrigin : false);
  };
}

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CORS controls which responses a browser may read; it does not stop a simple cross-origin POST
 * from reaching a handler. Verify browser mutation origins as a separate CSRF boundary while
 * keeping non-browser clients that do not send Origin compatible. */
export function requireAllowedMutationOrigin(origins: readonly string[]) {
  const explicitlyAllowed = new Set(origins);
  return async function publicApiOriginGuard(request: FastifyRequest, reply: FastifyReply) {
    if (SAFE_HTTP_METHODS.has(request.method)) return;
    const requestOrigin = request.headers.origin;
    if (!requestOrigin) return;

    const sameOrigin = request.host ? `${request.protocol}://${request.host}` : null;
    if (requestOrigin === sameOrigin || explicitlyAllowed.has(requestOrigin)) return;

    return reply.code(403).send({ message: "Origin není povolen" });
  };
}

export const AUTH_REGISTER_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
      password: { type: "string", minLength: 8, maxLength: 72 },
      displayName: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" }
    }
  }
} as const;

export const AUTH_LOGIN_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
      // Login remains compatible with accounts created before the eight-character policy.
      password: { type: "string", minLength: 1, maxLength: 72 }
    }
  }
} as const;

export const NO_BODY_SCHEMA = {
  // Fastify skips body validation when no payload was sent. If a caller does send one, only an
  // explicit JSON null is accepted; object/array payloads cannot smuggle unused fields.
  body: { type: "null" }
} as const;

export const CANONICALIZE_PLACE_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name", "lng", "lat"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 180, pattern: "\\S" },
      lng: { type: "number", minimum: -180, maximum: 180 },
      lat: { type: "number", minimum: -85, maximum: 85 },
      category: { type: "string", maxLength: 80 },
      sources: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source", "sourceRef"],
          properties: {
            source: { type: "string", minLength: 1, maxLength: 40 },
            sourceRef: { type: "string", minLength: 1, maxLength: 220 },
            payload: { type: "object", maxProperties: 64, additionalProperties: true }
          }
        }
      }
    }
  }
} as const;

export const PROTOTYPE_STAKING_AMOUNT_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["amountUsd"],
    properties: {
      // This is synthetic prototype credit, never a payment amount. A ceiling prevents accidental
      // Infinity-scale rows even when the explicit prototype feature gate is enabled.
      amountUsd: { type: "number", exclusiveMinimum: 0, maximum: 10_000 }
    }
  }
} as const;

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RequestRateLimiter {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now?: number
  ): RateLimitDecision | Promise<RateLimitDecision>;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * A deliberately small, bounded limiter for the current single API process.
 *
 * It is not presented as the eventual distributed limiter from the master plan. Its job is to
 * put finite budgets around the public prototype mutations now, without letting arbitrary source
 * IPs grow an unbounded Map. A shared token bucket can replace this class without changing route
 * handlers once the API is horizontally replicated.
 */
export class FixedWindowRateLimiter implements RequestRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly maxBuckets = 10_000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) {
      throw new Error("maxBuckets must be a positive integer");
    }
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be positive");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1)
      throw new Error("windowMs must be positive");

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      // Refresh insertion order for an expired key. On saturation evict exactly one oldest
      // bucket instead of scanning every attacker-controlled key on every new request.
      if (bucket) this.buckets.delete(key);
      if (this.buckets.size >= this.maxBuckets) {
        const oldestKey = this.buckets.keys().next().value as string | undefined;
        if (oldestKey !== undefined) this.buckets.delete(oldestKey);
      }
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    const allowed = bucket.count < limit;
    if (allowed) bucket.count += 1;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  get size() {
    return this.buckets.size;
  }

  clear() {
    this.buckets.clear();
  }
}

export interface IpRateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

export function rateLimitByIp(limiter: RequestRateLimiter, options: IpRateLimitOptions) {
  return async function publicApiRateLimit(request: FastifyRequest, reply: FastifyReply) {
    const decision = await limiter.consume(
      `${options.bucket}:${request.ip}`,
      options.limit,
      options.windowMs
    );
    reply.header("RateLimit-Limit", decision.limit);
    reply.header("RateLimit-Remaining", decision.remaining);
    reply.header("RateLimit-Reset", Math.ceil(decision.resetAt / 1000));
    if (!decision.allowed) {
      return reply
        .header("Retry-After", decision.retryAfterSeconds)
        .code(429)
        .send({ message: "Zkus to prosím za chvíli" });
    }
  };
}

interface ClassifiedBudget {
  bucket: string;
  limit: number;
  windowMs: number;
}

export function classifyRequestBudget(
  request: Pick<FastifyRequest, "method" | "routeOptions">
): ClassifiedBudget {
  const route = request.routeOptions.url ?? "/unmatched";
  const mutation = !SAFE_HTTP_METHODS.has(request.method);
  if (route.startsWith("/internal/")) return { bucket: "operations", limit: 120, windowMs: 60_000 };
  if (route.startsWith("/auth/") || route.startsWith("/v2/auth/")) {
    return { bucket: "auth", limit: 30, windowMs: 60_000 };
  }
  if (/import|publish/.test(route)) return { bucket: "import", limit: 20, windowMs: 60_000 };
  if (/commerce|checkout|payment|webhook|tip/.test(route)) {
    return { bucket: "commerce", limit: 120, windowMs: 60_000 };
  }
  if (/ai|cml|brief|summary/.test(route)) return { bucket: "ai", limit: 30, windowMs: 60_000 };
  // World REST carries position updates and read queries as POST. Keep its shared-IP
  // transport budget separate; worldRoutes also enforces per-account/action budgets.
  if (route.startsWith("/v2/world/")) return { bucket: "world", limit: 6000, windowMs: 60_000 };
  if (route.startsWith("/game/")) return { bucket: "game", limit: 120, windowMs: 60_000 };
  return mutation
    ? { bucket: "mutation", limit: 120, windowMs: 60_000 }
    : { bucket: "read", limit: 600, windowMs: 60_000 };
}

export interface GlobalRateLimitOptions {
  /**
   * Test-only capacity scaling for an isolated in-memory server. Production callers omit this
   * option, so the source-grounded public budgets remain unchanged.
   */
  limitMultiplier?: number;
}

/** One category budget per request; the backing store decides whether it is local or shared. */
export function rateLimitAllRequests(
  limiter: RequestRateLimiter,
  options: GlobalRateLimitOptions = {}
) {
  const limitMultiplier = options.limitMultiplier ?? 1;
  if (!Number.isSafeInteger(limitMultiplier) || limitMultiplier < 1 || limitMultiplier > 100) {
    throw new Error("limitMultiplier must be an integer between 1 and 100");
  }
  return async function globalApiRateLimit(request: FastifyRequest, reply: FastifyReply) {
    const budget = classifyRequestBudget(request);
    const decision = await limiter.consume(
      `${budget.bucket}:${request.ip}`,
      budget.limit * limitMultiplier,
      budget.windowMs
    );
    reply.header("RateLimit-Limit", decision.limit);
    reply.header("RateLimit-Remaining", decision.remaining);
    reply.header("RateLimit-Reset", Math.ceil(decision.resetAt / 1_000));
    if (!decision.allowed) {
      return reply
        .header("Retry-After", decision.retryAfterSeconds)
        .code(429)
        .send({ message: "Zkus to prosím za chvíli" });
    }
  };
}
