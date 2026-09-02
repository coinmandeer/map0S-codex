import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  assertDeclarativeHttpSourceV2,
  featureQueryResult,
  normalizeFeatureLimit,
  type FeatureQueryResultV2,
  type FeatureQueryV2,
  type LayerManifestV2,
  type MapOSFeatureV2
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { isPublicNetworkAddress } from "../utils/publicNetwork.js";
import { currentRequestCorrelationId } from "../observability/correlation.js";
import { operationalTelemetry } from "../observability/operationalTelemetry.js";
import { assertExternalNetworkAllowed } from "../offlineFixtureMode.js";
import { providerCircuitBreaker } from "../utils/upstream.js";

export { isPublicNetworkAddress } from "../utils/publicNetwork.js";

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

export interface DeclarativeHttpLayerRegistration {
  manifest: LayerManifestV2;
  /** Exact hostnames reviewed by the server operator. */
  allowedHosts: readonly string[];
  /** Resolved from authRef by trusted composition code; never accepted from a manifest/request. */
  authHeaders?: Readonly<Record<string, string>>;
}

export interface DeclarativeHttpLayerDependencies {
  /** Test seam. Production uses the pinned HTTPS requester below. */
  request?: DeclarativeHttpRequest;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  now?: () => Date;
}

export type DeclarativeHttpRequest = (
  url: URL,
  init: { headers: Readonly<Record<string, string>>; signal: AbortSignal },
  pinnedAddresses: readonly string[]
) => Promise<Response>;

async function systemResolveHost(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function pinnedHttpsRequest(
  url: URL,
  init: { headers: Readonly<Record<string, string>>; signal: AbortSignal },
  pinnedAddresses: readonly string[]
): Promise<Response> {
  const address = pinnedAddresses[0];
  const family = address ? isIP(address) : 0;
  if (!address || (family !== 4 && family !== 6)) {
    return Promise.reject(new ClientError("Declarative source has no verified address", 503));
  }
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: init.headers,
        signal: init.signal,
        servername: url.hostname,
        lookup(_hostname, _options, callback) {
          callback(null, address, family);
        }
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
            headers
          })
        );
      }
    );
    request.once("error", reject);
    request.end();
  });
}

function pathValue(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return Object.prototype.hasOwnProperty.call(current, segment)
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, value);
}

function boundedText(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, max) || fallback
    : fallback;
}

function coordinates(lngValue: unknown, latValue: unknown): [number, number] {
  const lng = Number(lngValue);
  const lat = Number(latValue);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new ClientError("Declarative source returned invalid coordinates", 502);
  }
  return [lng, lat];
}

function queryValue(mapping: string, query: FeatureQueryV2): string | null {
  const [west, south, east, north] = query.bbox;
  if (mapping === "bbox") return query.bbox.join(",");
  if (mapping === "west") return String(west);
  if (mapping === "south") return String(south);
  if (mapping === "east") return String(east);
  if (mapping === "north") return String(north);
  if (mapping === "limit") return String(normalizeFeatureLimit(query.limit));
  if (mapping === "cursor") return query.cursor?.slice(0, 512) ?? null;
  if (mapping === "zoom") return Number.isFinite(query.zoom) ? String(query.zoom) : null;
  if (mapping.startsWith("filter:")) {
    const filter = query.filters?.[mapping.slice(7)];
    if (filter === undefined || filter === null) return null;
    const encoded = Array.isArray(filter) ? filter.join(",") : String(filter);
    return encoded.slice(0, 500);
  }
  return null;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ClientError("Declarative source response is too large", 502);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new ClientError("Declarative source did not return JSON", 502);
  }
  if (!response.body) throw new ClientError("Declarative source returned an empty response", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ClientError("Declarative source response is too large", 502);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new ClientError("Declarative source returned invalid JSON", 502);
  }
}

function normalizeHosts(hosts: readonly string[]): Set<string> {
  return new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
}

async function validateTarget(
  url: URL,
  allowedHosts: ReadonlySet<string>,
  resolveHost: (hostname: string) => Promise<readonly string[]>
): Promise<readonly string[]> {
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0 ||
    !allowedHosts.has(hostname)
  ) {
    throw new ClientError("Declarative source target is not allowed", 503);
  }
  let addresses: readonly string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    throw new ClientError("Declarative source hostname could not be verified", 503);
  }
  if (!addresses.length || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw new ClientError("Declarative source resolved to a private or invalid address", 503);
  }
  return addresses;
}

export class DeclarativeHttpLayerService {
  readonly #registrations: ReadonlyMap<string, DeclarativeHttpLayerRegistration>;
  readonly #request: DeclarativeHttpRequest;
  readonly #resolveHost: (hostname: string) => Promise<readonly string[]>;
  readonly #now: () => Date;

  constructor(
    registrations: readonly DeclarativeHttpLayerRegistration[],
    dependencies: DeclarativeHttpLayerDependencies = {}
  ) {
    this.#registrations = new Map(registrations.map((entry) => [entry.manifest.id, entry]));
    this.#request = dependencies.request ?? pinnedHttpsRequest;
    this.#resolveHost = dependencies.resolveHost ?? systemResolveHost;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async features(
    layerId: string,
    query: FeatureQueryV2,
    callerSignal?: AbortSignal
  ): Promise<FeatureQueryResultV2> {
    const registration = this.#registrations.get(layerId);
    if (!registration) throw new ClientError("Layer source not found", 404);
    const providerId = registration.manifest.id;
    assertDeclarativeHttpSourceV2(registration.manifest.source);
    const source = registration.manifest.source;
    const allowedHosts = normalizeHosts(registration.allowedHosts);
    if (!allowedHosts.size) throw new ClientError("Layer source has no reviewed host", 503);
    let url = new URL(source.endpoint);
    for (const [name, mapping] of Object.entries(source.query ?? {})) {
      const value = queryValue(mapping, query);
      if (value !== null) url.searchParams.set(name, value);
    }
    assertExternalNetworkAllowed();
    const controller = new AbortController();
    let callerAborted = false;
    const abort = () => {
      callerAborted = true;
      controller.abort();
    };
    callerSignal?.addEventListener("abort", abort, { once: true });
    if (callerSignal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!providerCircuitBreaker.tryAcquire(providerId)) {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
      operationalTelemetry.recordProvider({
        provider: providerId,
        outcome: "circuit-open",
        durationMs: 0,
        correlationId: currentRequestCorrelationId()
      });
      throw new ClientError("Declarative source is temporarily paused", 503);
    }
    const startedAt = performance.now();
    try {
      let response: Response | null = null;
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        assertExternalNetworkAllowed();
        const pinnedAddresses = await validateTarget(url, allowedHosts, this.#resolveHost);
        try {
          response = await this.#request(
            url,
            {
              headers: { accept: "application/json", ...(registration.authHeaders ?? {}) },
              signal: controller.signal
            },
            pinnedAddresses
          );
        } catch (error) {
          if (controller.signal.aborted)
            throw new ClientError("Declarative source request timed out or was cancelled", 504);
          throw error;
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirects === MAX_REDIRECTS) {
            throw new ClientError("Declarative source redirect was rejected", 502);
          }
          await response.body?.cancel();
          url = new URL(location, url);
          continue;
        }
        break;
      }
      if (!response?.ok) throw new ClientError("Declarative source is unavailable", 502);
      const payload = await readBoundedJson(
        response,
        source.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
      );
      const mappedItems = pathValue(payload, source.mapping.itemsPath);
      if (!Array.isArray(mappedItems))
        throw new ClientError("Declarative source item mapping is invalid", 502);
      const limit = normalizeFeatureLimit(
        query.limit,
        registration.manifest.queryPolicy.maxResultsPerViewport
      );
      const now = this.#now().toISOString();
      const attribution = registration.manifest.attribution?.[0] ?? {
        label: registration.manifest.name
      };
      const features = mappedItems.slice(0, limit).map((item, index): MapOSFeatureV2 => {
        const id = boundedText(pathValue(item, source.mapping.idPath), 240, `row-${index + 1}`);
        const [lng, lat] = coordinates(
          pathValue(item, source.mapping.longitudePath),
          pathValue(item, source.mapping.latitudePath)
        );
        const sourceId = boundedText(pathValue(item, source.mapping.sourceIdPath), 240, id);
        return {
          schema: "mapos.feature",
          schemaVersion: "2.0.0",
          id: `${registration.manifest.id}:${id}`,
          revision: 1,
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            title: boundedText(pathValue(item, source.mapping.titlePath), 200, "Untitled feature"),
            kind: "place",
            category: boundedText(
              pathValue(item, source.mapping.categoryPath),
              100,
              registration.manifest.category
            ),
            layerIds: [registration.manifest.id],
            summary: boundedText(pathValue(item, source.mapping.summaryPath), 1_000) || null,
            description: boundedText(pathValue(item, source.mapping.descriptionPath), 4_000) || null
          },
          sources: [
            {
              providerId: registration.manifest.id,
              sourceId,
              retrievedAt: now,
              confidence: 1,
              attribution: attribution.label,
              license: attribution.license ?? null,
              rights: attribution.license ? "open" : "unknown"
            }
          ],
          access: { visibility: "public", permissions: ["view"] },
          createdAt: now,
          updatedAt: now
        };
      });
      const nextCursor =
        boundedText(pathValue(payload, source.mapping.nextCursorPath), 512) || null;
      const result = featureQueryResult({
        features,
        requestedLimit: limit,
        availableCount: mappedItems.length,
        nextCursor,
        sources: [{ providerId: registration.manifest.id, state: "ready" }]
      });
      providerCircuitBreaker.success(providerId);
      operationalTelemetry.recordProvider({
        provider: providerId,
        outcome: "success",
        durationMs: performance.now() - startedAt,
        correlationId: currentRequestCorrelationId()
      });
      return result;
    } catch (error) {
      if (callerAborted) providerCircuitBreaker.aborted(providerId);
      else providerCircuitBreaker.failure(providerId);
      operationalTelemetry.recordProvider({
        provider: providerId,
        outcome: callerAborted ? "aborted" : controller.signal.aborted ? "timeout" : "error",
        durationMs: performance.now() - startedAt,
        correlationId: currentRequestCorrelationId()
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
    }
  }
}
