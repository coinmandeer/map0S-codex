import type { DataProvider } from "@mapos/layer-sdk";
import { config } from "../config.js";
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
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`invalid point: ${raw}`);
  return [lng!, lat!];
}

async function osrmRoute(from: string, to: string, profile: RouteProfile): Promise<RouteResult> {
  const osrmProfile = PROFILE_MAP[profile] ?? "foot";
  const url = `${OSRM_BASE}/${osrmProfile}/${from};${to}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM error: ${res.status}`);
  const data = (await res.json()) as {
    routes: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }>;
  };
  const route = data.routes[0];
  if (!route) throw new Error("No route found");
  return {
    coordinates: route.geometry.coordinates,
    distanceM: route.distance,
    durationS: route.duration,
    provider: "osm",
    profile: osrmProfile
  };
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

export async function fetchRoute(
  from: string,
  to: string,
  profile: RouteProfile | MapyRouteProfile = "foot",
  options: { provider?: DataProvider; waypoints?: string[]; avoidToll?: boolean } = {}
): Promise<RouteResult> {
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
      return {
        coordinates,
        distanceM: route.length,
        durationS: route.duration,
        provider: "mapy",
        profile: mapyProfile,
        elevation: await sampleElevation(coordinates)
      };
    } catch (err) {
      // A dead upstream or an exhausted quota must not break route planning outright.
      console.warn("Mapy routing failed, falling back to OSRM:", err);
    }
  }

  const osrmProfile: RouteProfile = isMapyRouteProfile(profile)
    ? MAPY_TO_OSRM[profile]
    : (profile as RouteProfile);
  return osrmRoute(from, to, osrmProfile);
}
