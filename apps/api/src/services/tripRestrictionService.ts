import type { TripRestriction, TripVehicle } from "@mapos/layer-sdk";
import { fetchOverpass } from "../utils/overpass.js";

const CACHE_TTL_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; values: TripRestriction[] }>();

type Coord = [number, number];

export function sampleRouteCoordinates(coordinates: Coord[], limit = 70): Coord[] {
  if (coordinates.length <= limit) return coordinates;
  const step = (coordinates.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => coordinates[Math.round(index * step)]!);
}

export function parseRestrictionLimit(raw: unknown): number | null {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  const imperial = /^(\d+)'(\d{1,2})?(?:"|''|in)?$/.exec(text);
  if (imperial) {
    const metres = Number(imperial[1]) * 0.3048 + Number(imperial[2] ?? 0) * 0.0254;
    return Math.round(metres * 100) / 100;
  }
  const match = /(\d+(?:[.,]\d+)?)/.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function exceeds(kind: TripRestriction["kind"], limit: number | null, vehicle: TripVehicle) {
  if (kind === "hgv") return vehicle.profile === "truck";
  if (limit === null) return false;
  if (kind === "maxheight") return (vehicle.heightM ?? 0) > limit;
  if (kind === "maxwidth") return (vehicle.widthM ?? 0) > limit;
  if (kind === "maxweight") return (vehicle.weightT ?? 0) > limit;
  return false;
}

export function parseRestrictionElements(
  elements: Array<{
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  }>,
  vehicle: TripVehicle
): TripRestriction[] {
  const kinds: TripRestriction["kind"][] = [
    "maxheight",
    "maxweight",
    "maxwidth",
    "maxlength",
    "hgv"
  ];
  const seen = new Set<string>();
  const values: TripRestriction[] = [];
  for (const element of elements ?? []) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    for (const kind of kinds) {
      const raw = element.tags?.[kind];
      if (!raw) continue;
      const key = `${kind}:${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const limit = kind === "hgv" ? null : parseRestrictionLimit(raw);
      values.push({
        kind,
        lng: Number(lng),
        lat: Number(lat),
        limit,
        raw: raw.slice(0, 24),
        name: element.tags?.name?.slice(0, 90) ?? null,
        exceedsVehicle: exceeds(kind, limit, vehicle)
      });
    }
  }
  return values.slice(0, 150);
}

function cacheKey(coordinates: Coord[], vehicle: TripVehicle) {
  const points = sampleRouteCoordinates(coordinates, 20)
    .map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`)
    .join(";");
  return `${points}|${vehicle.profile}|${vehicle.heightM}|${vehicle.widthM}|${vehicle.weightT}`;
}

export async function checkTripRestrictions(
  coordinates: Coord[],
  vehicle: TripVehicle,
  timeoutMs = 3_500
): Promise<{ values: TripRestriction[]; available: boolean }> {
  if (!["camper", "truck"].includes(vehicle.profile)) {
    return { values: [], available: true };
  }
  const sampled = sampleRouteCoordinates(coordinates);
  if (sampled.length < 2) return { values: [], available: false };
  const key = cacheKey(sampled, vehicle);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { values: cached.values, available: true };
  }

  const around = sampled.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(",");
  const query =
    `[out:json][timeout:8];(` +
    `nw["maxheight"](around:35,${around});` +
    `nw["maxweight"](around:35,${around});` +
    `nw["maxwidth"](around:35,${around});` +
    `nw["maxlength"](around:35,${around});` +
    `nw["hgv"~"^(no|private)$"](around:35,${around});` +
    `);out center tags 150;`;
  try {
    const payload = await fetchOverpass<{
      elements?: Parameters<typeof parseRestrictionElements>[0];
    }>(query, { timeoutMs });
    const values = parseRestrictionElements(payload.elements ?? [], vehicle);
    cache.set(key, { at: Date.now(), values });
    return { values, available: true };
  } catch {
    return { values: [], available: false };
  }
}

export const __testing = { cache };
