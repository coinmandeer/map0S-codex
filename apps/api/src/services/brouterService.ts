/**
 * BRouter: the router behind the "Dobrodružná" preference (§16.6).
 *
 * Its profiles are the point. `trekking` and `mtb` weight paths, tracks and quiet lanes the way
 * someone looking for an interesting way there would, which is something no car router can be
 * asked for — before this, "adventurous" was a fast route with a different label.
 *
 * Keyless and self-hostable (`BROUTER_BASE_URL`). Variants are separate requests, because BRouter
 * returns one track per call and indexes the alternatives itself.
 */

import { config } from "../config.js";
import { ClientError, safeErrorLogFields } from "../utils/clientError.js";
import { fetchJson } from "../utils/upstream.js";

export type BrouterProfile = "trekking" | "mtb";

export function isBrouterProfile(value: string): value is BrouterProfile {
  return value === "trekking" || value === "mtb";
}

export interface BrouterRoute {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  /** Metres above sea level per coordinate; BRouter carries them in the geometry itself. */
  elevation?: (number | null)[];
}

export interface BrouterFeatureCollection {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: number[][] };
  }>;
}

/** BRouter reports its numbers as strings. An absent one stays absent: `Number("")` is 0, and a
 *  segment of zero metres would look like a routed answer. */
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** BRouter's GeoJSON as a segment, or `null` when the payload is not a routed track. */
export function parseBrouterTrack(payload: BrouterFeatureCollection): BrouterRoute | null {
  const feature = payload.features?.[0];
  const raw = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== "LineString" || !Array.isArray(raw) || raw.length < 2) {
    return null;
  }
  const coordinates: [number, number][] = [];
  const elevation: (number | null)[] = [];
  for (const point of raw) {
    const [longitude, latitude, altitude] = point;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    coordinates.push([longitude!, latitude!]);
    elevation.push(Number.isFinite(altitude) ? altitude! : null);
  }
  if (coordinates.length < 2) return null;

  const properties = feature.properties ?? {};
  const distanceM = numeric(properties["track-length"]);
  const durationS = numeric(properties["total-time"]);
  // A track without its length is not a routed segment: the plan shows kilometres and minutes,
  // and estimating them from the geometry would present a guess as a provider answer.
  if (distanceM === null || durationS === null) return null;

  return {
    coordinates,
    distanceM,
    durationS,
    ...(elevation.some((value) => value !== null) ? { elevation } : {})
  };
}

async function brouterTrack(
  lonlats: string,
  profile: BrouterProfile,
  alternativeIndex: number
): Promise<BrouterRoute | null> {
  const url = `${config.brouterBaseUrl}?lonlats=${lonlats}&profile=${profile}&alternativeidx=${alternativeIndex}&format=geojson`;
  const payload = await fetchJson<BrouterFeatureCollection>(url, {
    providerId: "routing-brouter",
    ttlMs: 5 * 60_000,
    timeoutMs: 12_000,
    maxResponseBytes: 4 * 1024 * 1024
  });
  return parseBrouterTrack(payload);
}

export interface BrouterRouteRequest {
  /** `lng,lat` strings, at least two, in travel order. */
  points: readonly string[];
  profile: BrouterProfile;
  /** BRouter indexes its own variants; two is what the itinerary can show side by side. */
  alternatives?: number;
}

export async function fetchBrouterRoutes(request: BrouterRouteRequest): Promise<BrouterRoute[]> {
  if (request.points.length < 2) throw new ClientError("BRouter needs at least two points");
  const lonlats = request.points.join("|");
  const wanted = Math.min(2, Math.max(1, Math.floor(request.alternatives ?? 1)));

  const primary = await brouterTrack(lonlats, request.profile, 0);
  if (!primary) throw new ClientError("BRouter nenašel trasu pro tento profil", 404);
  if (wanted === 1) return [primary];

  try {
    const alternative = await brouterTrack(lonlats, request.profile, 1);
    return alternative ? [primary, alternative] : [primary];
  } catch (error) {
    // A missing second variant is not a failed segment; the first route already answers.
    console.warn("BRouter alternative unavailable", safeErrorLogFields(error));
    return [primary];
  }
}
