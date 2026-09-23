import type { Bbox, GeoFeature } from "@mapos/layer-sdk";

/**
 * How far the map has moved since a layer last fetched, as a share of the old viewport's span.
 *
 * Two things count as movement: the centre sliding away, and the span growing or shrinking. A
 * layer that queries Overpass cannot follow every pan, but it also should not sit stale while
 * the user pans a screen and a half, so the caller compares this against a threshold.
 */
export function viewportDrift(previous: Bbox, next: Bbox): number {
  const [w0, s0, e0, n0] = previous;
  const [w1, s1, e1, n1] = next;
  const span = Math.max(e0 - w0, n0 - s0, 0.001);
  const centreShift =
    Math.hypot((w1 + e1) / 2 - (w0 + e0) / 2, (s1 + n1) / 2 - (s0 + n0) / 2) / span;
  const sizeRatio = Math.max(e1 - w1, n1 - s1) / span;
  // A halving or a doubling is as big a change as sliding a whole screen: both mean the old
  // answer was for a different question.
  const zoomShift = sizeRatio >= 1 ? sizeRatio - 1 : 1 / Math.max(sizeRatio, 0.001) - 1;
  return Math.max(centreShift, zoomShift);
}

/** Cells per side of the sampling grid. 5 × 5 is coarse enough that a handful of pins in one
 *  corner does not read as coverage, and fine enough to stay cheap for thousands of features. */
const GRID = 5;

/**
 * The share of the viewport that has anything in it, from 0 to 1.
 *
 * Counting features is the wrong measure: two hundred restaurants down one street leave the
 * rest of the screen as empty as no restaurants at all. So the viewport is cut into a grid and
 * the answer is how many cells got at least one feature — which is what "this area looks empty"
 * means to someone looking at it.
 */
export function viewportCoverage(features: readonly GeoFeature[], bbox: Bbox): number {
  const [west, south, east, north] = bbox;
  const width = east - west;
  const height = north - south;
  if (width <= 0 || height <= 0) return 0;

  const occupied = new Set<number>();
  for (const feature of features) {
    for (const [lng, lat] of featurePositions(feature)) {
      if (lng < west || lng > east || lat < south || lat > north) continue;
      const column = Math.min(GRID - 1, Math.floor(((lng - west) / width) * GRID));
      const row = Math.min(GRID - 1, Math.floor(((lat - south) / height) * GRID));
      occupied.add(row * GRID + column);
    }
    if (occupied.size === GRID * GRID) break;
  }
  return occupied.size / (GRID * GRID);
}

/** Points of a feature, flattened: a line crossing the screen covers every cell it passes. */
function* featurePositions(feature: GeoFeature): Generator<[number, number]> {
  const geometry = feature.geometry;
  if (geometry.type === "Point") {
    yield geometry.coordinates as [number, number];
    return;
  }
  if (geometry.type === "LineString") {
    for (const position of geometry.coordinates) yield position as [number, number];
  }
}
