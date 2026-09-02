import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { config } from "../config.js";
import { currentRequestCorrelationId } from "../observability/correlation.js";
import { operationalTelemetry } from "../observability/operationalTelemetry.js";
import { assertExternalNetworkAllowed } from "../offlineFixtureMode.js";
import {
  assertProviderId,
  ProviderCircuitBreaker
} from "../observability/providerCircuitBreaker.js";
import { isPublicNetworkAddress } from "./publicNetwork.js";

/** Shared, DNS-pinned client for the public APIs MapOS reads. */

export class UpstreamError extends Error {
  constructor(
    readonly providerId: string,
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
const MAX_ENTRIES = 500;
const inFlight = new Map<string, Promise<unknown>>();
export const providerCircuitBreaker = new ProviderCircuitBreaker();

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
  if (ttlMs <= 0) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

interface CommonFetchOptions {
  /** Stable adapter slug. Display names, URLs and user-controlled values are forbidden. */
  providerId: string;
  ttlMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Minimum delay between starts for the same provider. */
  minIntervalMs?: number;
  /** Retries for rate limits and temporary 5xx responses. */
  retries?: number;
  /** Hard upper bound after decompression. Defaults to 4 MiB and cannot exceed 16 MiB. */
  maxResponseBytes?: number;
}

export interface FetchJsonOptions extends CommonFetchOptions {
  method?: "GET" | "POST";
  body?: string;
}

export interface FetchTextOptions extends CommonFetchOptions {
  acceptedContentTypes?: readonly string[];
}

export interface FetchBytesOptions extends CommonFetchOptions {
  acceptedContentTypes?: readonly string[];
}

export interface FetchMetadataOptions extends CommonFetchOptions {
  method: "HEAD" | "GET";
}

export interface UpstreamMetadata {
  status: number;
  headers: Headers;
}

interface RequestInitPinned {
  method: "GET" | "POST" | "HEAD";
  body?: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

type ResolveHost = (hostname: string) => Promise<readonly string[]>;
type PinnedRequest = (
  url: URL,
  init: RequestInitPinned,
  pinnedAddresses: readonly string[]
) => Promise<Response>;

interface UpstreamTestDependencies {
  resolveHost?: ResolveHost;
  request?: PinnedRequest;
}

let testDependencies: UpstreamTestDependencies | null = null;

/** Explicit test seam; production composition never calls this. */
export function __setUpstreamTestDependencies(value: UpstreamTestDependencies | null): void {
  testDependencies = value;
}

const nextRequestAt = new Map<string, number>();

async function waitForProvider(providerId: string, intervalMs: number) {
  if (intervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt.get(providerId) ?? now);
  nextRequestAt.set(providerId, slot + intervalMs);
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(5_000, Math.max(0, seconds * 1000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(5_000, Math.max(0, date - Date.now()));
  }
  return Math.min(2_000, 250 * 2 ** attempt);
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export function validateUpstreamUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Upstream URL is invalid");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    hostname === "metadata.google.internal"
  ) {
    throw new TypeError("Upstream URL is not an allowed public HTTPS endpoint");
  }
  parsed.hash = "";
  return parsed;
}

async function systemResolveHost(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

/** Node 20+ may request an `all:true` lookup for automatic family selection. Returning the old
 * scalar callback shape in that case produces ERR_INVALID_IP_ADDRESS before TLS even starts. */
export function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function pinnedHttpsRequest(
  url: URL,
  init: RequestInitPinned,
  pinnedAddresses: readonly string[]
): Promise<Response> {
  // Prefer IPv4 on hosts without IPv6 egress, but never resolve again inside the socket layer.
  const address = pinnedAddresses.find((candidate) => isIP(candidate) === 4) ?? pinnedAddresses[0];
  const family = address ? isIP(address) : 0;
  if (!address || (family !== 4 && family !== 6)) {
    return Promise.reject(new Error("upstream has no verified address"));
  }
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        servername: url.hostname,
        lookup: createPinnedLookup(address, family)
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
            headers
          })
        );
      }
    );
    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

async function secureRequest(
  url: URL,
  init: RequestInitPinned,
  providerId: string
): Promise<Response> {
  assertExternalNetworkAllowed();
  const resolveHost = testDependencies?.resolveHost ?? systemResolveHost;
  const request = testDependencies?.request ?? pinnedHttpsRequest;
  let addresses: readonly string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new UpstreamError(providerId, "adresu zdroje nelze bezpečně ověřit");
  }
  // Reject a mixed public/private answer rather than selecting the convenient public member: a
  // later retry must never become a DNS-rebinding hop to a private service.
  if (!addresses.length || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw new UpstreamError(providerId, "zdroj neukazuje výhradně na veřejnou síť");
  }
  return request(url, init, addresses);
}

function normalizedMaxBytes(value: number | undefined): number {
  const requested = Number.isFinite(value) ? Number(value) : 4 * 1024 * 1024;
  return Math.min(16 * 1024 * 1024, Math.max(1_024, Math.floor(requested)));
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await response.body?.cancel();
    throw new Error("response-too-large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("response-too-large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function acceptsContentType(contentType: string | null, accepted: readonly string[]): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return accepted.some((item) => {
    const normalized = item.toLowerCase();
    return normalized.endsWith("/*")
      ? mediaType.startsWith(normalized.slice(0, -1))
      : mediaType === normalized ||
          (normalized === "application/json" && mediaType.endsWith("+json"));
  });
}

async function fetchDecoded<T>(
  responseKind: string,
  url: string,
  options: CommonFetchOptions & { method?: "GET" | "POST"; body?: string },
  acceptedContentTypes: readonly string[],
  decode: (bytes: Uint8Array, contentType: string) => T
): Promise<T> {
  assertExternalNetworkAllowed();
  const providerId = assertProviderId(options.providerId);
  const method = options.method ?? "GET";
  const body = options.body;
  if (body !== undefined && Buffer.byteLength(body) > 1024 * 1024) {
    throw new TypeError("Upstream request body exceeds 1 MiB");
  }
  const safeUrl = validateUpstreamUrl(url);
  const ttlMs = Math.min(24 * 3600_000, Math.max(0, options.ttlMs ?? 5 * 60_000));
  const timeoutMs = Math.min(30_000, Math.max(250, options.timeoutMs ?? 12_000));
  const retries = Math.min(3, Math.max(0, Math.floor(options.retries ?? 0)));
  const minIntervalMs = Math.min(60_000, Math.max(0, options.minIntervalMs ?? 0));
  const maxResponseBytes = normalizedMaxBytes(options.maxResponseBytes);
  const key = `${responseKind}|${providerId}|${method}|${safeUrl.href}|${body ?? ""}`;

  const cached = readCache<T>(key);
  if (cached !== undefined) return cached;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  if (!providerCircuitBreaker.tryAcquire(providerId)) {
    operationalTelemetry.recordProvider({
      provider: providerId,
      outcome: "circuit-open",
      durationMs: 0,
      correlationId: currentRequestCorrelationId()
    });
    throw new UpstreamError(providerId, "zdroj je dočasně pozastaven po opakovaných chybách");
  }

  const request = (async () => {
    const startedAt = performance.now();
    let outcome: "error" | "timeout" | "aborted" = "error";
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        await waitForProvider(providerId, minIntervalMs);
        let response: Response;
        try {
          const timeoutSignal = AbortSignal.timeout(timeoutMs);
          const signal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;
          response = await secureRequest(
            safeUrl,
            {
              method,
              body,
              headers: {
                Accept: acceptedContentTypes.join(", "),
                "User-Agent": config.userAgent,
                ...options.headers
              },
              signal
            },
            providerId
          );
        } catch (error) {
          if (options.signal?.aborted === true) {
            outcome = "aborted";
            throw new UpstreamError(providerId, "požadavek na zdroj byl zrušen");
          }
          if (attempt < retries) continue;
          const timedOut =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError");
          outcome = timedOut ? "timeout" : "error";
          if (error instanceof UpstreamError) throw error;
          throw new UpstreamError(
            providerId,
            timedOut ? "zdroj neodpověděl včas" : "zdroj je nedostupný"
          );
        }

        if (!response.ok) {
          if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
            await response.body?.cancel();
            const waitMs = retryDelayMs(response, attempt);
            if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          await response.body?.cancel();
          throw new UpstreamError(providerId, `${providerId} odpověděl ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!acceptsContentType(contentType, acceptedContentTypes)) {
          await response.body?.cancel();
          throw new UpstreamError(providerId, "zdroj vrátil nepodporovaný typ odpovědi");
        }
        let bytes: Uint8Array;
        try {
          bytes = await readBoundedBody(response, maxResponseBytes);
        } catch (error) {
          if (error instanceof Error && error.message === "response-too-large") {
            throw new UpstreamError(providerId, "zdroj vrátil příliš velkou odpověď");
          }
          throw error;
        }
        const value = decode(bytes, contentType!);
        writeCache(key, value, ttlMs);
        providerCircuitBreaker.success(providerId);
        operationalTelemetry.recordProvider({
          provider: providerId,
          outcome: "success",
          durationMs: performance.now() - startedAt,
          correlationId: currentRequestCorrelationId()
        });
        return value;
      }
      throw new UpstreamError(providerId, "zdroj neodpověděl");
    } catch (error) {
      if (options.signal?.aborted === true) outcome = "aborted";
      else if (
        outcome === "error" &&
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        outcome = "timeout";
      }
      if (outcome === "aborted") providerCircuitBreaker.aborted(providerId);
      else providerCircuitBreaker.failure(providerId);
      operationalTelemetry.recordProvider({
        provider: providerId,
        outcome,
        durationMs: performance.now() - startedAt,
        correlationId: currentRequestCorrelationId()
      });
      throw error;
    }
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  return fetchDecoded("json", url, options, ["application/json"], (bytes) => {
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      throw new UpstreamError(options.providerId, "zdroj vrátil neplatný JSON");
    }
  });
}

export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  return fetchDecoded(
    "text",
    url,
    options,
    options.acceptedContentTypes ?? ["text/plain", "text/csv"],
    (bytes) => new TextDecoder().decode(bytes)
  );
}

export async function fetchBytes(
  url: string,
  options: FetchBytesOptions
): Promise<{ body: ArrayBuffer; contentType: string }> {
  return fetchDecoded(
    "bytes",
    url,
    options,
    options.acceptedContentTypes ?? ["application/octet-stream"],
    (bytes, contentType) => {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return { body, contentType };
    }
  );
}

/**
 * DNS-pinned, no-redirect metadata probe for the small set of iframe hosts allowed by CSP.
 * Bodies are cancelled inside this function and never escape to callers. HTTP status and headers
 * remain visible because redirect and framing policy need to interpret 3xx, 405 and CSP headers;
 * transport failures still participate in the same per-provider circuit and telemetry as JSON,
 * text and byte reads.
 */
export async function fetchMetadata(
  url: string,
  options: FetchMetadataOptions
): Promise<UpstreamMetadata> {
  assertExternalNetworkAllowed();
  const providerId = assertProviderId(options.providerId);
  const safeUrl = validateUpstreamUrl(url);
  const timeoutMs = Math.min(30_000, Math.max(250, options.timeoutMs ?? 12_000));

  if (!providerCircuitBreaker.tryAcquire(providerId)) {
    operationalTelemetry.recordProvider({
      provider: providerId,
      outcome: "circuit-open",
      durationMs: 0,
      correlationId: currentRequestCorrelationId()
    });
    throw new UpstreamError(providerId, "zdroj je dočasně pozastaven po opakovaných chybách");
  }

  const startedAt = performance.now();
  let outcome: "success" | "error" | "timeout" | "aborted";
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const response = await secureRequest(
      safeUrl,
      {
        method: options.method,
        headers: {
          Accept: "*/*",
          "User-Agent": config.userAgent,
          ...options.headers
        },
        signal
      },
      providerId
    );
    await response.body?.cancel();
    outcome = response.status >= 500 || response.status === 429 ? "error" : "success";
    if (outcome === "success") providerCircuitBreaker.success(providerId);
    else providerCircuitBreaker.failure(providerId);
    operationalTelemetry.recordProvider({
      provider: providerId,
      outcome,
      durationMs: performance.now() - startedAt,
      correlationId: currentRequestCorrelationId()
    });
    return { status: response.status, headers: response.headers };
  } catch (error) {
    const callerAborted = options.signal?.aborted === true;
    const timedOut =
      !callerAborted &&
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    outcome = callerAborted ? "aborted" : timedOut ? "timeout" : "error";
    if (callerAborted) providerCircuitBreaker.aborted(providerId);
    else providerCircuitBreaker.failure(providerId);
    operationalTelemetry.recordProvider({
      provider: providerId,
      outcome,
      durationMs: performance.now() - startedAt,
      correlationId: currentRequestCorrelationId()
    });
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(
      providerId,
      callerAborted
        ? "požadavek na zdroj byl zrušen"
        : timedOut
          ? "zdroj neodpověděl včas"
          : "zdroj je nedostupný"
    );
  }
}

/** Test seam — module-level caches otherwise leak between specs. */
export function __resetUpstreamCache() {
  cache.clear();
  inFlight.clear();
  nextRequestAt.clear();
  providerCircuitBreaker.clear();
  testDependencies = null;
}
