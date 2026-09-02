import { isValidCoordinates, parseCoordinates, type Coordinates } from "./coordinates.js";
import { containsControlCharacters } from "./textSafety.js";

export type MapShareProvider = "mapos" | "google" | "openstreetmap" | "mapy" | "apple";

export interface ParsedMapShareLocation extends Coordinates {
  provider: MapShareProvider;
  zoom?: number;
}

export interface MapShareUrlOptions {
  /** Exact application origins, for example `https://mapos.example`. */
  maposOrigins?: readonly string[];
}

const GOOGLE_HOSTS = new Set(["www.google.com", "maps.google.com"]);
const OSM_HOSTS = new Set(["openstreetmap.org", "www.openstreetmap.org"]);
const MAPY_HOSTS = new Set(["mapy.com", "www.mapy.com", "mapy.cz", "www.mapy.cz"]);
const APPLE_HOSTS = new Set(["maps.apple.com"]);

function finiteParameter(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validZoom(value: number | null): number | undefined {
  return value !== null && value >= 0 && value <= 24 ? value : undefined;
}

function location(
  provider: MapShareProvider,
  lat: number | null,
  lng: number | null,
  zoom?: number
): ParsedMapShareLocation | null {
  if (lat === null || lng === null || !isValidCoordinates({ lat, lng })) return null;
  return zoom === undefined ? { provider, lat, lng } : { provider, lat, lng, zoom };
}

function parsePair(value: string | null): Coordinates | null {
  if (!value) return null;
  const parsed = parseCoordinates(value);
  return parsed ? { lat: parsed.lat, lng: parsed.lng } : null;
}

function mapHash(url: URL): ParsedMapShareLocation | null {
  const match = url.hash.match(
    /^#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:[&/]|$)/
  );
  if (!match) return null;
  const zoom = validZoom(Number(match[1]));
  const lat = Number(match[2]);
  const lng = Number(match[3]);
  return location("openstreetmap", lat, lng, zoom);
}

function allowedOrigins(values: readonly string[] | undefined): Set<string> {
  const result = new Set<string>();
  for (const value of values ?? []) {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.pathname.replace(/\//g, "")
      ) {
        result.add(url.origin);
      }
    } catch {
      // An invalid configured origin must not widen the allowlist.
    }
  }
  return result;
}

function parseMapos(url: URL): ParsedMapShareLocation | null {
  const pair = parsePair(url.searchParams.get("center"));
  const lat = pair?.lat ?? finiteParameter(url.searchParams.get("lat"));
  const lng =
    pair?.lng ?? finiteParameter(url.searchParams.get("lng") ?? url.searchParams.get("lon"));
  const zoom = validZoom(
    finiteParameter(url.searchParams.get("z") ?? url.searchParams.get("zoom"))
  );
  return location("mapos", lat, lng, zoom);
}

function parseGoogle(url: URL): ParsedMapShareLocation | null {
  const at = url.pathname.match(
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?)z)?(?:,|\/|$)/
  );
  if (at) {
    return location(
      "google",
      Number(at[1]),
      Number(at[2]),
      validZoom(finiteParameter(at[3] ?? null))
    );
  }
  const pair = parsePair(url.searchParams.get("query") ?? url.searchParams.get("q"));
  return pair ? location("google", pair.lat, pair.lng) : null;
}

function parseOsm(url: URL): ParsedMapShareLocation | null {
  const lat = finiteParameter(url.searchParams.get("mlat"));
  const lng = finiteParameter(url.searchParams.get("mlon"));
  if (lat !== null || lng !== null) return location("openstreetmap", lat, lng);
  return mapHash(url);
}

function parseMapy(url: URL): ParsedMapShareLocation | null {
  return location(
    "mapy",
    finiteParameter(url.searchParams.get("y")),
    finiteParameter(url.searchParams.get("x")),
    validZoom(finiteParameter(url.searchParams.get("z")))
  );
}

function parseApple(url: URL): ParsedMapShareLocation | null {
  const pair = parsePair(url.searchParams.get("ll"));
  const zoom = validZoom(finiteParameter(url.searchParams.get("z")));
  return pair ? location("apple", pair.lat, pair.lng, zoom) : null;
}

/**
 * Extracts coordinates from MapOS and a small, exact allowlist of public map-share formats.
 * It never follows redirects, so opaque short links intentionally return `null`.
 */
export function parseMapShareUrl(
  input: string,
  options: MapShareUrlOptions = {}
): ParsedMapShareLocation | null {
  if (typeof input !== "string" || input.length > 2048 || containsControlCharacters(input)) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;

  const relative = /^(?:\/[^/]|\/\?|\?|#)/.test(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed, "https://relative.mapos.invalid/");
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (relative) return url.origin === "https://relative.mapos.invalid" ? parseMapos(url) : null;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return null;

  const hostname = url.hostname.toLowerCase();
  if (allowedOrigins(options.maposOrigins).has(url.origin)) return parseMapos(url);
  if (GOOGLE_HOSTS.has(hostname)) return parseGoogle(url);
  if (OSM_HOSTS.has(hostname)) return parseOsm(url);
  if (MAPY_HOSTS.has(hostname)) return parseMapy(url);
  if (APPLE_HOSTS.has(hostname)) return parseApple(url);
  return null;
}
