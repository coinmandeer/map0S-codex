import type { DataProvider } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { ClientError, safeErrorLogFields } from "../utils/clientError.js";
import { fetchJson } from "../utils/upstream.js";
import {
  isMapyRouteProfile,
  mapyElevation,
  mapyRoute,
  type MapyRouteProfile
} from "./mapyService.js";

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

const PROFILE_MAP = {
  foot: "foot",
  bike: "bike",
  car: "driving"
} as const;

export type RouteProfile = keyof typeof PROFILE_MAP;

/** Mapy's richer profiles collapse onto OSRM's three when we fall back, so callers can always
 *  ask for `foot_hiking` and get *a* route even without a Mapy key. */
const MAPY_TO_OSRM: Record<MapyRouteProfile, RouteProfile> = {
  car_fast: "car",
  car_fast_traffic: "car",
  car_short: "car",
  foot_fast: "foot",
  foot_hiking: "foot",
  bike_road: "bike",
  bike_mountain: "bike"
};

export interface RouteResult {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  provider: DataProvider;
  profile: string;
  /** Metres above sea level per coordinate, when the provider can supply it. */
  elevation?: (number | null)[];
}

function parsePoint(raw: string): [number, number] {
  const [lng, lat] = raw.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new ClientError(`invalid point: ${raw}`);
  }
  return [lng!, lat!];
}

async function osrmRoutes(
  from: string,
  to: string,
  profile: RouteProfile,
  waypoints: string[] = [],
  alternatives = 1
): Promise<RouteResult[]> {
  const osrmProfile = PROFILE_MAP[profile] ?? "foot";
  const points = [from, ...waypoints, to].join(";");
  const alternativeCount = Math.min(2, Math.max(1, Math.floor(alternatives)));
  // A simplified GeoJSON overview is sufficient for an interactive plan and keeps the optional
  // second route economical on mobile data. Waypoint metadata is unused, so omit it as well.
  const url = `${OSRM_BASE}/${osrmProfile}/${points}?overview=simplified&geometries=geojson&alternatives=${alternativeCount > 1 ? alternativeCount : "false"}&skip_waypoints=true`;
  const data = await fetchJson<{
    routes: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }>;
  }>(url, {
    providerId: "routing-osrm",
    ttlMs: 5 * 60_000,
    timeoutMs: 10_000,
    maxResponseBytes: 4 * 1024 * 1024
  });
  if (!data.routes.length) throw new ClientError("No route found", 404);
  return data.routes.slice(0, alternativeCount).map((route) => ({
    coordinates: route.geometry.coordinates,
    distanceM: route.distance,
    durationS: route.duration,
    provider: "osm" as const,
    profile: osrmProfile
  }));
}

/** Samples the route at ~20 evenly spaced points — enough for a profile chart, far below the
 *  elevation endpoint's cost of one call per point at full geometry resolution. */
async function sampleElevation(
  coordinates: [number, number][]
): Promise<(number | null)[] | undefined> {
  if (coordinates.length < 2) return undefined;
  const step = Math.max(1, Math.floor(coordinates.length / 20));
  const sampled = coordinates.filter((_, i) => i % step === 0);
  try {
    return await mapyElevation(sampled);
  } catch {
    return undefined;
  }
}

export interface FetchRouteOptions {
  provider?: DataProvider;
  waypoints?: string[];
  avoidToll?: boolean;
  /** OSRM can return fewer routes than requested. Kept at two to bound transfer and UI fan-out. */
  alternatives?: number;
}

export async function fetchRouteAlternatives(
  from: string,
  to: string,
  profile: RouteProfile | MapyRouteProfile = "foot",
  options: FetchRouteOptions = {}
): Promise<RouteResult[]> {
  const wantsMapy = options.provider === "mapy" && Boolean(config.mapyKey);

  if (wantsMapy) {
    const mapyProfile: MapyRouteProfile = isMapyRouteProfile(profile)
      ? profile
      : profile === "car"
        ? "car_fast_traffic"
        : profile === "bike"
          ? "bike_road"
          : "foot_fast";
    try {
      const waypoints = [
        parsePoint(from),
        ...(options.waypoints ?? []).map(parsePoint),
        parsePoint(to)
      ];
      const route = await mapyRoute({
        waypoints,
        profile: mapyProfile,
        avoidToll: options.avoidToll
      });
      const coordinates = route.geometry.coordinates;
      return [
        {
          coordinates,
          distanceM: route.length,
          durationS: route.duration,
          provider: "mapy",
          profile: mapyProfile,
          elevation: await sampleElevation(coordinates)
        }
      ];
    } catch (err) {
      // A dead upstream or an exhausted quota must not break route planning outright.
      console.warn("Mapy routing failed; using OSRM fallback", safeErrorLogFields(err));
    }
  }

  const osrmProfile: RouteProfile = isMapyRouteProfile(profile)
    ? MAPY_TO_OSRM[profile]
    : (profile as RouteProfile);
  return osrmRoutes(from, to, osrmProfile, options.waypoints, options.alternatives ?? 1);
}

export async function fetchRoute(
  from: string,
  to: string,
  profile: RouteProfile | MapyRouteProfile = "foot",
  options: FetchRouteOptions = {}
): Promise<RouteResult> {
  const routes = await fetchRouteAlternatives(from, to, profile, {
    ...options,
    alternatives: 1
  });
  return routes[0]!;
}
