import type { DistanceUnits } from "../settings/preferences";

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

export function formatDistance(metres: number, units: DistanceUnits): string {
  const safe = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  if (units === "imperial") {
    const miles = safe / METRES_PER_MILE;
    return miles >= 0.1
      ? `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`
      : `${Math.round(safe / METRES_PER_FOOT)} ft`;
  }
  return safe >= 1_000 ? `${(safe / 1_000).toFixed(1)} km` : `${Math.round(safe)} m`;
}
