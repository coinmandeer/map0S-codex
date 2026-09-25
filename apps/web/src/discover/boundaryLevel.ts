export type BoundaryLevel = "country" | "adm1" | "adm2" | "lau";
const LEVELS: readonly BoundaryLevel[] = ["country", "adm1", "adm2", "lau"];
const THRESHOLDS = [4, 7, 10];

/** A selected municipality is the last drill-down step; its outline would cover the detailed map. */
export function showAreaBoundaries(
  enabled: boolean,
  zoom: number,
  selectedLevel?: BoundaryLevel | null
): boolean {
  return enabled && zoom < 13.5 && selectedLevel !== "lau";
}

/** Administrative levels only. NUTS is a separate statistical hierarchy, never a fallback
 * advertised as a county/city. Hysteresis keeps fractional wheel zooms from thrashing sources. */
export function boundaryLevel(zoom: number, previous?: BoundaryLevel): BoundaryLevel {
  const value = Number.isFinite(zoom) ? zoom : 0;
  if (!previous) return LEVELS[THRESHOLDS.filter((threshold) => value >= threshold).length]!;
  let index = LEVELS.indexOf(previous);
  while (index < LEVELS.length - 1 && value >= THRESHOLDS[index]! + 0.25) index++;
  while (index > 0 && value < THRESHOLDS[index - 1]! - 0.25) index--;
  return LEVELS[index]!;
}

export function availableBoundaryLevel(
  requested: BoundaryLevel,
  available: readonly string[]
): BoundaryLevel | null {
  for (let index = LEVELS.indexOf(requested); index >= 0; index--) {
    if (available.includes(LEVELS[index]!)) return LEVELS[index]!;
  }
  return null;
}
