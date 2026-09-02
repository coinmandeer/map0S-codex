/**
 * Tile proxy for basemap providers that need a key.
 *
 * Keyless backgrounds (CARTO, OpenFreeMap, Sentinel-2, NASA) go straight from the browser to the
 * upstream — proxying them would only add a hop. Everything here needs a secret the browser must
 * never see, which is the whole reason this module exists. Google additionally needs a session
 * token negotiated ahead of the first tile, so "build a URL" is async for everyone.
 */

import { config } from "../config.js";
import { fetchBytes, fetchJson } from "../utils/upstream.js";

export class TileProviderUnavailableError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} tile key is not configured`);
    this.name = "TileProviderUnavailableError";
  }
}

interface TileRequest {
  mapset: string;
  z: number;
  x: number;
  y: number;
  retina: boolean;
}

interface TileProvider {
  id: string;
  /** The capability flag the browser sees. */
  capability: string;
  mapsets: string[];
  key(): string | undefined;
  url(req: TileRequest, key: string): string | Promise<string>;
  /** Some upstreams reject a browser-ish User-Agent or need an auth header. */
  headers?(key: string): Record<string, string>;
}

/** Google hands out a session token that covers many tiles and lives for hours; asking for one
 *  per tile would be both slow and a quota bonfire. Cached per map type, refreshed early. */
const googleSessions = new Map<string, { token: string; expiresAt: number }>();

async function googleSession(mapType: string, key: string): Promise<string> {
  const cached = googleSessions.get(mapType);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const data = await fetchJson<{ session?: string; expiry?: string }>(
    `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`,
    {
      providerId: "basemap-google-session",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapType, language: "cs-CZ", region: "CZ" }),
      ttlMs: 0,
      timeoutMs: 12_000,
      maxResponseBytes: 256 * 1024
    }
  );
  if (!data.session) throw new Error("google createSession returned no token");

  // `expiry` is a unix timestamp in seconds. Renew a few minutes early so a tile request never
  // races the expiry it was issued under.
  const expirySec = Number(data.expiry);
  const expiresAt = Number.isFinite(expirySec)
    ? expirySec * 1000 - 5 * 60_000
    : Date.now() + 60 * 60_000;
  googleSessions.set(mapType, { token: data.session, expiresAt });
  return data.session;
}

const PROVIDERS: TileProvider[] = [
  {
    id: "mapy",
    capability: "mapy",
    mapsets: ["basic", "outdoor", "winter", "aerial", "names-overlay"],
    key: () => config.mapyKey,
    url: ({ mapset, z, x, y, retina }, key) => {
      // Retina exists only for the drawn maps; asking for it on aerial returns a 404.
      const size = retina && (mapset === "basic" || mapset === "outdoor") ? "256@2x" : "256";
      return `https://api.mapy.com/v1/maptiles/${mapset}/${size}/${z}/${x}/${y}?apikey=${encodeURIComponent(key)}`;
    }
  },
  {
    id: "google",
    capability: "googleTiles",
    mapsets: ["roadmap", "satellite", "terrain"],
    key: () => config.tileKeys.google,
    url: async ({ mapset, z, x, y }, key) => {
      const session = await googleSession(mapset, key);
      return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`;
    }
  },
  {
    id: "here",
    capability: "here",
    mapsets: ["explore", "satellite"],
    key: () => config.tileKeys.here,
    url: ({ mapset, z, x, y, retina }, key) => {
      const style = mapset === "satellite" ? "explore.satellite.day" : "explore.day";
      const format = mapset === "satellite" ? "jpeg" : "png8";
      const size = retina ? 512 : 256;
      return `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/${format}?style=${style}&size=${size}&apiKey=${encodeURIComponent(key)}`;
    }
  },
  {
    id: "maptiler",
    capability: "maptiler",
    mapsets: ["streets-v2", "outdoor-v2", "winter-v2", "satellite-v2"],
    key: () => config.tileKeys.maptiler,
    url: ({ mapset, z, x, y, retina }, key) => {
      if (mapset === "satellite-v2") {
        return `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${encodeURIComponent(key)}`;
      }
      const scale = retina ? "@2x" : "";
      return `https://api.maptiler.com/maps/${mapset}/${z}/${x}/${y}${scale}.png?key=${encodeURIComponent(key)}`;
    }
  },
  {
    id: "thunderforest",
    capability: "thunderforest",
    mapsets: ["landscape", "outdoors", "cycle", "transport"],
    key: () => config.tileKeys.thunderforest,
    url: ({ mapset, z, x, y, retina }, key) =>
      `https://tile.thunderforest.com/${mapset}/${z}/${x}/${y}${retina ? "@2x" : ""}.png?apikey=${encodeURIComponent(key)}`
  },
  {
    id: "stadia",
    capability: "stadia",
    mapsets: ["alidade_satellite", "alidade_smooth", "alidade_smooth_dark", "outdoors"],
    key: () => config.tileKeys.stadia,
    url: ({ mapset, z, x, y, retina }, key) => {
      const ext = mapset === "alidade_satellite" ? "jpg" : "png";
      const scale = retina && ext === "png" ? "@2x" : "";
      return `https://tiles.stadiamaps.com/tiles/${mapset}/${z}/${x}/${y}${scale}.${ext}?api_key=${encodeURIComponent(key)}`;
    }
  },
  {
    id: "tomtom",
    capability: "tomtom",
    mapsets: ["basic", "sat"],
    key: () => config.tileKeys.tomtom,
    url: ({ mapset, z, x, y }, key) =>
      mapset === "sat"
        ? `https://api.tomtom.com/map/1/tile/sat/main/${z}/${x}/${y}.jpg?key=${encodeURIComponent(key)}`
        : `https://api.tomtom.com/map/1/tile/basic/main/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}`
  },
  {
    id: "geoapify",
    capability: "geoapify",
    mapsets: ["osm-bright", "osm-carto", "dark-matter", "positron"],
    key: () => config.tileKeys.geoapify,
    url: ({ mapset, z, x, y, retina }, key) =>
      `https://maps.geoapify.com/v1/tile/${mapset}/${z}/${x}/${y}.png?apiKey=${encodeURIComponent(key)}${retina ? "&scaleFactor=2" : ""}`
  }
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** The capability flag a provider hides behind. `config.capabilities()` computes the flags
 *  themselves — it cannot import this module without a cycle — so this exists to keep the two
 *  spellings verifiable from a test rather than by eye. */
export function providerCapabilities(): Record<string, string> {
  return Object.fromEntries(PROVIDERS.map((p) => [p.id, p.capability]));
}

export interface TileResponse {
  body: ArrayBuffer;
  contentType: string;
}

export async function fetchBasemapTile(
  providerId: string,
  req: TileRequest
): Promise<TileResponse> {
  const provider = BY_ID.get(providerId);
  if (!provider) throw new TileProviderUnavailableError(providerId);
  if (!provider.mapsets.includes(req.mapset)) {
    throw new TileProviderUnavailableError(`${providerId}/${req.mapset}`);
  }
  const key = provider.key();
  if (!key) throw new TileProviderUnavailableError(providerId);

  return fetchBytes(await provider.url(req, key), {
    providerId: `basemap-${provider.id}`,
    headers: provider.headers?.(key),
    ttlMs: 0,
    timeoutMs: 12_000,
    maxResponseBytes: 4 * 1024 * 1024,
    acceptedContentTypes: ["image/*", "application/octet-stream"]
  });
}

/** Test seam: the Google session cache is module state. */
export function __resetTileSessions(): void {
  googleSessions.clear();
}
