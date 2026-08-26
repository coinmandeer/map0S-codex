/** Thin server-side proxy for api.mapy.com.
 *
 *  Everything Mapy-shaped goes through here for one reason: MAPY_API_KEY must never reach the
 *  browser. The frontend asks `/api/mapy/*`, this module attaches the key and forwards.
 *  Attribution is a licence condition, not a nicety — the map logo control is mandatory
 *  whenever Mapy tiles are displayed (see MapyLogo on the web side).
 */

import type { Bbox } from "@mapos/layer-sdk";
import { config } from "../config.js";

const BASE = "https://api.mapy.com";

export const MAPY_ATTRIBUTION = "© Seznam.cz a.s. a další";

export class MapyNotConfiguredError extends Error {
  constructor() {
    super("MAPY_API_KEY is not set");
    this.name = "MapyNotConfiguredError";
  }
}

export type MapyMapset = "basic" | "outdoor" | "winter" | "aerial" | "names-overlay";

const MAPSETS = new Set<MapyMapset>(["basic", "outdoor", "winter", "aerial", "names-overlay"]);

export function isMapyMapset(value: string): value is MapyMapset {
  return MAPSETS.has(value as MapyMapset);
}

function keyOrThrow(): string {
  const key = config.mapyKey;
  if (!key) throw new MapyNotConfiguredError();
  return key;
}

async function mapyJson<T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apikey", keyOrThrow());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
    signal: AbortSignal.timeout(12_000)
  });
  if (!res.ok) throw new Error(`mapy ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** Raster tile bytes plus content type, for streaming straight back to the client. */
export async function fetchMapyTile(
  mapset: MapyMapset,
  z: number,
  x: number,
  y: number,
  retina: boolean
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const suffix = retina ? "@2x" : "";
  const url = `${BASE}/v1/maptiles/${mapset}/256${suffix}/${z}/${x}/${y}?apikey=${encodeURIComponent(keyOrThrow())}`;
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
    signal: AbortSignal.timeout(12_000)
  });
  if (!res.ok) throw new Error(`mapy tile ${res.status}`);
  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "image/png"
  };
}

export interface MapyGeocodeItem {
  name: string;
  label: string;
  location: string;
  position: { lon: number; lat: number };
  type: string;
  regionalStructure?: { name: string; type: string }[];
}

interface MapyItemsResponse {
  items?: Array<{
    name?: string;
    label?: string;
    location?: string;
    position?: { lon: number; lat: number };
    type?: string;
    regionalStructure?: { name: string; type: string }[];
  }>;
}

function normalizeItems(data: MapyItemsResponse): MapyGeocodeItem[] {
  return (data.items ?? [])
    .filter((i) => i.position && Number.isFinite(i.position.lon) && Number.isFinite(i.position.lat))
    .map((i) => ({
      name: i.name ?? i.label ?? "",
      label: i.label ?? i.name ?? "",
      location: i.location ?? "",
      position: i.position!,
      type: i.type ?? "poi",
      regionalStructure: i.regionalStructure
    }));
}

export async function mapyGeocode(
  query: string,
  lang = "cs",
  limit = 8
): Promise<MapyGeocodeItem[]> {
  const data = await mapyJson<MapyItemsResponse>("/v1/geocode", { query, lang, limit });
  return normalizeItems(data);
}

/** Suggest with an optional hard bbox filter — the primitive the keyword-matrix POI engine
 *  is built on. `locality=BOX(...)` restricts results to the box rather than merely biasing
 *  them, which is what makes cell-by-cell scanning possible at all. */
export async function mapySuggest(opts: {
  query: string;
  lang?: string;
  limit?: number;
  bbox?: Bbox;
  type?: "poi" | "regional" | "regional.address";
  preferNear?: [number, number];
}): Promise<MapyGeocodeItem[]> {
  const params: Record<string, string | number | undefined> = {
    query: opts.query,
    lang: opts.lang ?? "cs",
    limit: Math.min(opts.limit ?? 15, 15),
    type: opts.type ?? "poi"
  };
  if (opts.bbox) {
    const [w, s, e, n] = opts.bbox;
    params.locality = `BOX(${w},${s},${e},${n})`;
  }
  if (opts.preferNear) {
    params.preferNear = `${opts.preferNear[0]},${opts.preferNear[1]}`;
  }
  const data = await mapyJson<MapyItemsResponse>("/v1/suggest", params);
  return normalizeItems(data);
}

export type MapyRouteProfile =
  | "car_fast"
  | "car_fast_traffic"
  | "car_short"
  | "foot_fast"
  | "foot_hiking"
  | "bike_road"
  | "bike_mountain";

const ROUTE_PROFILES = new Set<MapyRouteProfile>([
  "car_fast",
  "car_fast_traffic",
  "car_short",
  "foot_fast",
  "foot_hiking",
  "bike_road",
  "bike_mountain"
]);

export function isMapyRouteProfile(value: string): value is MapyRouteProfile {
  return ROUTE_PROFILES.has(value as MapyRouteProfile);
}

export interface MapyRoute {
  length: number;
  duration: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export async function mapyRoute(opts: {
  waypoints: [number, number][];
  profile: MapyRouteProfile;
  avoidToll?: boolean;
}): Promise<MapyRoute> {
  const [start, ...rest] = opts.waypoints;
  const end = rest.pop();
  if (!start || !end) throw new Error("route needs at least two waypoints");

  const params: Record<string, string | number | undefined> = {
    start: `${start[0]},${start[1]}`,
    end: `${end[0]},${end[1]}`,
    routeType: opts.profile,
    format: "geojson",
    avoidToll: opts.avoidToll ? "true" : undefined
  };
  if (rest.length) params.waypoints = rest.map((w) => `${w[0]},${w[1]}`).join(";");

  const data = await mapyJson<{
    length?: number;
    duration?: number;
    geometry?: { type: string; coordinates: [number, number][] };
  }>("/v1/routing/route", params);

  return {
    length: data.length ?? 0,
    duration: data.duration ?? 0,
    geometry: {
      type: "LineString",
      coordinates: data.geometry?.coordinates ?? [start, end]
    }
  };
}

/** Elevation for a list of positions — used for route profiles and peak enrichment. */
export async function mapyElevation(positions: [number, number][]): Promise<(number | null)[]> {
  if (!positions.length) return [];
  const data = await mapyJson<{ items?: { elevation?: number }[] }>("/v1/elevation", {
    positions: positions.map((p) => `${p[0]},${p[1]}`).join(";")
  });
  return positions.map((_, i) => data.items?.[i]?.elevation ?? null);
}
