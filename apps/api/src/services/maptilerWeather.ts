import { fetchBytes, fetchJson } from "../utils/upstream.js";
import { config } from "../config.js";

/**
 * MapTiler Weather.
 *
 * MapTiler publishes weather as pre-rendered, animated tiles: one tileset id per keyframe, five
 * variables (radar, precipitation, temperature, pressure, wind) and 72 hourly frames. The tile
 * URL embeds the API key, so the browser never calls MapTiler directly — the server resolves the
 * keyframe and proxies the image, exactly like the OWM tiles.
 */
const CATALOG_URL = "https://api.maptiler.com/weather/latest.json";
const TILE_HOST = "https://api.maptiler.com";
const CATALOG_TTL_MS = 30 * 60_000;

export interface MapTilerWeatherVariable {
  id: string;
  name: string;
  unit: string;
  minzoom: number;
  maxzoom: number;
  keyframes: { id: string; timestamp: string }[];
}

let catalogCache: { at: number; variables: MapTilerWeatherVariable[] } | null = null;

interface RawCatalog {
  variables?: Array<{
    keyframes?: Array<{ id?: unknown; timestamp?: unknown }>;
    metadata?: {
      minzoom?: unknown;
      maxzoom?: unknown;
      weather_variable?: { variable_id?: unknown; name?: unknown; unit?: unknown };
    };
  }>;
}

export function maptilerWeatherConfigured(): boolean {
  return Boolean(config.tileKeys.maptiler);
}

export async function fetchMapTilerWeatherCatalog(
  signal?: AbortSignal
): Promise<MapTilerWeatherVariable[]> {
  const key = config.tileKeys.maptiler;
  if (!key) throw new Error("MapTiler weather requires MAPTILER_API_KEY");
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.variables;
  }
  const data = await fetchJson<RawCatalog>(`${CATALOG_URL}?key=${encodeURIComponent(key)}`, {
    providerId: "maptiler-weather",
    signal,
    ttlMs: 0,
    timeoutMs: 12_000,
    maxResponseBytes: 2 * 1024 * 1024
  });
  const variables = (data.variables ?? [])
    .map((entry): MapTilerWeatherVariable | null => {
      const meta = entry.metadata ?? {};
      const weather = meta.weather_variable ?? {};
      const id = typeof weather.variable_id === "string" ? weather.variable_id : "";
      const keyframes = (Array.isArray(entry.keyframes) ? entry.keyframes : []).flatMap((frame) =>
        typeof frame?.id === "string" && typeof frame?.timestamp === "string"
          ? [{ id: frame.id, timestamp: frame.timestamp }]
          : []
      );
      if (!id || !keyframes.length) return null;
      return {
        id,
        name: typeof weather.name === "string" ? weather.name : id,
        unit: typeof weather.unit === "string" ? weather.unit : "",
        minzoom: Number(meta.minzoom ?? 0),
        maxzoom: Number(meta.maxzoom ?? 3),
        keyframes
      };
    })
    .filter((value): value is MapTilerWeatherVariable => value !== null);
  catalogCache = { at: Date.now(), variables };
  return variables;
}

export async function fetchMapTilerWeatherTile(
  variableId: string,
  frameIndex: number,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal
): Promise<{ body: Buffer; contentType: string } | null> {
  const key = config.tileKeys.maptiler;
  if (!key) return null;
  if (!Number.isInteger(z) || z < 0 || z > 12) return null;
  const max = 2 ** z;
  if (!Number.isInteger(x) || x < 0 || x >= max || !Number.isInteger(y) || y < 0 || y >= max) {
    return null;
  }
  const variables = await fetchMapTilerWeatherCatalog(signal);
  const variable = variables.find((entry) => entry.id === variableId);
  if (!variable) return null;
  const index = Math.max(0, Math.min(variable.keyframes.length - 1, Math.trunc(frameIndex)));
  const keyframe = variable.keyframes[index]!;
  const url = `${TILE_HOST}/tiles/${encodeURIComponent(keyframe.id)}/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}`;
  const { body, contentType } = await fetchBytes(url, {
    providerId: "maptiler-weather",
    signal,
    ttlMs: 30 * 60_000,
    timeoutMs: 15_000,
    maxResponseBytes: 2 * 1024 * 1024,
    acceptedContentTypes: ["image/png", "image/jpeg"]
  });
  return { body: Buffer.from(body), contentType };
}
