import { config } from "../config.js";

/**
 * Shared client for the public APIs MapOS reads.
 *
 * Every one of these is somebody's free service, so the rules are the same everywhere: identify
 * ourselves, give up rather than hang, and don't ask twice for something we just asked for.
 */

export class UpstreamError extends Error {
  constructor(
    readonly source: string,
    message: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** Bounded so a long-running server can't accumulate every viewport anyone ever looked at. */
const MAX_ENTRIES = 500;

/** In-flight requests are shared: two users panning to the same area shouldn't double the load
 *  on a volunteer-run API. */
const inFlight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown, ttlMs: number) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export interface FetchJsonOptions {
  /** Names the upstream in errors and logs, so a failure says which service broke. */
  source: string;
  ttlMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const { source, ttlMs = 5 * 60_000, timeoutMs = 12_000 } = options;
  const key = `${source}|${url}`;

  const cached = readCache<T>(key);
  if (cached !== undefined) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          // Nominatim, Overpass and the Wikimedia APIs block generic user agents outright, and
          // the rest are entitled to know who is calling them.
          "User-Agent": config.userAgent,
          ...options.headers
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new UpstreamError(source, timedOut ? "zdroj neodpověděl včas" : "zdroj je nedostupný");
    }

    if (!res.ok) {
      throw new UpstreamError(source, `${source} odpověděl ${res.status}`);
    }
    const value = (await res.json()) as T;
    writeCache(key, value, ttlMs);
    return value;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

/** Test seam — module-level caches otherwise leak between specs. */
export function __resetUpstreamCache() {
  cache.clear();
  inFlight.clear();
}
