import maplibregl from "maplibre-gl";

const SCHEME = "mapos-tile";
const MAX_ENTRIES = 240;
let maxBytes = 32 * 1024 * 1024;
let bytes = 0;
interface CachedTile {
  data: ArrayBuffer;
  cacheControl: string | null;
  expires: string | null;
  expiresAt: number;
  etag?: string | null;
  modified?: string | null;
}
interface Flight {
  controller: AbortController;
  promise: Promise<CachedTile>;
  subscribers: number;
  settled: boolean;
}
const cache = new Map<string, CachedTile>();
const inFlight = new Map<string, Flight>();
let registered = false;

export function registerTileCacheProtocol(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(SCHEME, async (params, controller) => {
    const tile = await loadTile(unwrapTileUrl(params.url), controller.signal);
    // MapLibre may transfer the buffer to a worker. Never detach the shared cache's copy.
    return {
      data: tile.data.slice(0),
      cacheControl: tile.cacheControl ?? undefined,
      expires: tile.expires ?? undefined
    };
  });
}

export function cachedTileTemplate(template: string): string {
  return /^https?:\/\//i.test(template) ? `${SCHEME}://${template}` : template;
}
export function unwrapTileUrl(url: string): string {
  return url.startsWith(`${SCHEME}://`) ? url.slice(SCHEME.length + 3) : url;
}

function remove(url: string) {
  const entry = cache.get(url);
  if (entry) bytes -= entry.data.byteLength;
  cache.delete(url);
}
function remember(url: string, tile: CachedTile) {
  remove(url);
  if (/no-store/i.test(tile.cacheControl ?? "") || tile.data.byteLength > maxBytes) return;
  cache.set(url, tile);
  bytes += tile.data.byteLength;
  while (cache.size > MAX_ENTRIES || bytes > maxBytes) remove(cache.keys().next().value!);
}

function freshness(headers: Headers, cacheControl: string | null, expires: string | null) {
  if (/no-store|no-cache/i.test(cacheControl ?? "")) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(cacheControl ?? "");
  const age = Math.max(0, Number(headers.get("age")) || 0) * 1000;
  const date = Date.parse(headers.get("date") ?? "");
  const elapsed = Number.isFinite(date) ? Math.max(0, Date.now() - date) : 0;
  if (maxAge) return Date.now() + Math.max(0, Number(maxAge[1]) * 1000 - Math.max(age, elapsed));
  const expiration = Date.parse(expires ?? "");
  return Number.isFinite(expiration) ? expiration : 0;
}

/** Independent consumers share transport; the last cancellation aborts it. */
export async function loadTile(url: string, signal: AbortSignal): Promise<CachedTile> {
  signal.throwIfAborted();
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) {
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  let flight = inFlight.get(url);
  if (!flight) {
    const controller = new AbortController();
    const headers = new Headers();
    if (hit?.etag) headers.set("If-None-Match", hit.etag);
    else if (hit?.modified) headers.set("If-Modified-Since", hit.modified);
    flight = { controller, subscribers: 0, settled: false, promise: null as never };
    const current = flight;
    flight.promise = (async () => {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        credentials: "omit"
      });
      if (!response.ok && !(response.status === 304 && hit))
        throw new Error(`Tile request failed with ${response.status}`);
      const revalidated = response.status === 304;
      const cacheControl =
        response.headers.get("cache-control") ?? (revalidated ? hit!.cacheControl : null);
      const expires = response.headers.get("expires") ?? (revalidated ? hit!.expires : null);
      const tile: CachedTile = {
        data: revalidated ? hit!.data : await response.arrayBuffer(),
        cacheControl,
        expires,
        expiresAt: freshness(response.headers, cacheControl, expires),
        etag: response.headers.get("etag") ?? (revalidated ? hit!.etag : null),
        modified: response.headers.get("last-modified") ?? (revalidated ? hit!.modified : null)
      };
      controller.signal.throwIfAborted();
      remember(url, tile);
      return tile;
    })().finally(() => {
      current.settled = true;
      if (inFlight.get(url) === current) inFlight.delete(url);
    });
    inFlight.set(url, flight);
  }
  const current = flight;
  current.subscribers++;
  return new Promise<CachedTile>((resolve, reject) => {
    let done = false;
    const finish = (error?: unknown, tile?: CachedTile) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      current.subscribers--;
      if (!current.subscribers && !current.settled) {
        current.controller.abort();
        if (inFlight.get(url) === current) inFlight.delete(url);
      }
      if (error) reject(error);
      else resolve(tile!);
    };
    const abort = () => finish(new DOMException("Tile request aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (tile) => finish(undefined, tile),
      (error) => finish(error)
    );
    if (signal.aborted) abort();
  });
}

export function configureTileCache(lowData: boolean): void {
  maxBytes = (lowData ? 16 : 32) * 1024 * 1024;
  while (bytes > maxBytes && cache.size) remove(cache.keys().next().value!);
}
export function resetTileCache(): void {
  for (const flight of inFlight.values()) flight.controller.abort();
  inFlight.clear();
  cache.clear();
  bytes = 0;
}
export function tileCacheSize(): number {
  return cache.size;
}
export function tileCacheStats() {
  return { entries: cache.size, bytes, maxBytes, inFlight: inFlight.size };
}
