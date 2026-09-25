import { mapyBudget } from "./providerBudget/mapy.js";
/** Thin server-side proxy for api.mapy.com.
 *
 *  Everything Mapy-shaped goes through here for one reason: MAPY_API_KEY must never reach the
 *  browser. The frontend asks `/api/mapy/*`, this module attaches the key and forwards.
 *  Attribution is a licence condition, not a nicety — the map logo control is mandatory
 *  whenever Mapy tiles are displayed (see MapyLogo on the web side).
 */

import type { Bbox } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { fetchBytes, fetchJson } from "../utils/upstream.js";

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
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apikey", keyOrThrow());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return fetchJson<T>(url.toString(), {
    signal,
    providerId: "mapy-api",
    budget: mapyBudget(
      path.includes("matrix")
        ? "matrix"
        : path.includes("routing")
          ? "route"
          : path.includes("elevation")
            ? "elevation"
            : "geocode"
    ),
    ttlMs: 5 * 60_000,
    timeoutMs: 12_000,
    maxResponseBytes: 4 * 1024 * 1024
  });
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
  return fetchBytes(url, {
    providerId: "mapy-tiles",
    budget: mapyBudget("tile"),
    // Browser/CDN cache headers own tile retention; keeping binary tiles in the JSON LRU would
    // waste API heap while providing no additional network saving.
    ttlMs: 0,
    timeoutMs: 12_000,
    maxResponseBytes: 4 * 1024 * 1024,
    acceptedContentTypes: ["image/*"]
  });
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
  limit = 8,
  signal?: AbortSignal
): Promise<MapyGeocodeItem[]> {
  const data = await mapyJson<MapyItemsResponse>("/v1/geocode", { query, lang, limit }, signal);
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
  type?: "poi" | "regional" | "regional.address" | "all";
  preferNear?: [number, number];
  signal?: AbortSignal;
}): Promise<MapyGeocodeItem[]> {
  const params: Record<string, string | number | undefined> = {
    query: opts.query,
    lang: opts.lang ?? "cs",
    limit: Math.min(opts.limit ?? 15, 15),
    type: opts.type === "all" ? undefined : (opts.type ?? "poi")
  };
  if (opts.bbox) {
    const [w, s, e, n] = opts.bbox;
    params.locality = `BOX(${w},${s},${e},${n})`;
  }
  if (opts.preferNear) {
    params.preferNear = `${opts.preferNear[0]},${opts.preferNear[1]}`;
  }
  const data = await mapyJson<MapyItemsResponse>("/v1/suggest", params, opts.signal);
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
  signal?: AbortSignal;
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

  const data = await mapyJson<MapyRoutePayload>("/v1/routing/route", params, opts.signal);
  const route = normalizeMapyRoute(data);
  assertRouteAccess(data.routePoints, opts.profile);
  return route;
}

export class RouteAccessError extends Error {
  readonly name = "RouteAccessError";
}
export function assertRouteAccess(
  points: MapyRoutePayload["routePoints"],
  profile: MapyRouteProfile
) {
  for (const [i, point] of (points ?? []).entries()) {
    if (!point.restricted) continue;
    if (point.restrictionType === "PEDESTRIAN_ZONE" && profile.startsWith("foot_")) continue;
    const reason =
      point.restrictionType === "CLOSURE"
        ? "uzavírka"
        : point.restrictionType === "NO_ENTRY"
          ? "zákaz vstupu nebo vjezdu"
          : "omezený přístup";
    throw new RouteAccessError(`Zastávka ${i + 1}: ${reason}. Zvolte dostupný přístupový bod.`);
  }
}
export interface MapyRoutePayload {
  routePoints?: { restricted?: boolean; restrictionType?: string }[];
  length?: number;
  duration?: number;
  geometry?: {
    type?: string;
    coordinates?: unknown;
    geometry?: { type?: string; coordinates?: unknown };
  };
}

/** Mapy returns a GeoJSON Feature, not a bare LineString. Never invent a road on failure. */
export function normalizeMapyRoute(data: MapyRoutePayload): MapyRoute {
  const geometry = data.geometry?.type === "Feature" ? data.geometry.geometry : data.geometry;
  const coordinates = geometry?.coordinates;
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !coordinates.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90
    ) ||
    !Number.isFinite(data.length) ||
    data.length! < 0 ||
    !Number.isFinite(data.duration) ||
    data.duration! < 0
  )
    throw new Error("Mapy returned invalid route geometry or metrics");
  return {
    length: data.length!,
    duration: data.duration!,
    geometry: { type: "LineString", coordinates: coordinates.map((p) => [p[0], p[1]]) }
  };
}

/** Elevation for a list of positions — used for route profiles and peak enrichment. */
export async function mapyElevation(
  positions: [number, number][],
  signal?: AbortSignal
): Promise<(number | null)[]> {
  if (!positions.length) return [];
  const data = await mapyJson<{ items?: { elevation?: number }[] }>(
    "/v1/elevation",
    {
      positions: positions.map((p) => `${p[0]},${p[1]}`).join(";")
    },
    signal
  );
  return positions.map((_, i) => data.items?.[i]?.elevation ?? null);
}

/** A bounded 10×10 matrix shares the same project credits as tiles and search. */
export async function mapyRouteMatrix(
  points: readonly [number, number][],
  profile: MapyRouteProfile,
  signal?: AbortSignal
): Promise<number[][]> {
  if (
    points.length < 2 ||
    points.length > 10 ||
    !points.every(
      (p) =>
        p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
    )
  )
    throw new Error("Invalid matrix points");
  const data = await mapyJson<{ matrix?: { length: number; duration: number }[][] }>(
    "/v1/routing/matrix-m",
    { starts: points.map((p) => p.join(",")).join(";"), routeType: profile },
    signal
  );
  if (
    !Array.isArray(data.matrix) ||
    data.matrix.length !== points.length ||
    !data.matrix.every((row) => Array.isArray(row) && row.length === points.length)
  )
    throw new Error("Invalid routing matrix");
  return data.matrix.map((row) =>
    row.map((cell) =>
      Number.isFinite(cell?.duration) && cell.duration >= 0 && cell.length >= 0
        ? cell.duration
        : Infinity
    )
  );
}
