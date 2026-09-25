import { fetchRoute, type RouteProfile, type RouteResult } from "../routingService.js";
import { config } from "../../config.js";
export function tripProfile(message: string): RouteProfile {
  const q = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(auto|autem|car|drive|driving)\b/.test(q)
    ? "car"
    : /\b(kolo|kole|bike|bicycle|cyklo\w*)\b/.test(q)
      ? "bike"
      : "foot";
}
/** Douglas–Peucker simplification preserves bends and both endpoints. */
export function routeOverview(
  points: readonly [number, number][],
  limit = 500
): [number, number][] {
  if (!Number.isInteger(limit) || limit < 2)
    throw new Error("At least two route points are required");
  if (points.length <= limit) return points.map((p) => [...p]);
  const simplify = (tolerance: number) => {
    const kept = new Set([0, points.length - 1]),
      stack: [[number, number]] | [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop()!,
        a = points[start]!,
        b = points[end]!;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = dx * dx + dy * dy;
      let farthest = -1,
        max = tolerance * tolerance;
      for (let i = start + 1; i < end; i++) {
        const p = points[i]!,
          t = length
            ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
            : 0;
        const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
        if (distance > max) {
          max = distance;
          farthest = i;
        }
      }
      if (farthest >= 0) {
        kept.add(farthest);
        stack.push([start, farthest], [farthest, end]);
      }
    }
    return [...kept].sort((a, b) => a - b).map((i) => [...points[i]!] as [number, number]);
  };
  let tolerance = 0.000001,
    result = simplify(tolerance);
  while (result.length > limit) {
    tolerance *= 2;
    result = simplify(tolerance);
  }
  return result;
}
export async function routeChatPlan(
  stops: readonly { longitude: number; latitude: number }[],
  profile: RouteProfile,
  signal?: AbortSignal
): Promise<RouteResult> {
  if (stops.length < 2 || stops.length > 40) throw new Error("Trasa potřebuje 2–40 zastávek");
  const results: RouteResult[] = [];
  // Keep each computed leg so the saved draft has the same geometry and metrics as the map.
  for (let i = 0; i < stops.length - 1; i += 1) {
    signal?.throwIfAborted();
    const chunk = stops.slice(i, i + 2),
      point = (p: (typeof chunk)[number]) => `${p.longitude},${p.latitude}`;
    results.push(
      await fetchRoute(
        point(chunk[0]!),
        point(chunk.at(-1)!),
        profile === "foot" && config.mapyKey ? "foot_hiking" : profile,
        {
          signal,
          provider: config.mapyKey ? "mapy" : "osm",
          waypoints: chunk.slice(1, -1).map(point)
        }
      )
    );
  }
  const legs = results.map((r) => ({ ...r, coordinates: routeOverview(r.coordinates, 500) }));
  return {
    legs,
    coordinates: legs.flatMap((r, i) => (i ? r.coordinates.slice(1) : r.coordinates)),
    distanceM: results.reduce((s, r) => s + r.distanceM, 0),
    durationS: results.reduce((s, r) => s + r.durationS, 0),
    profile,
    provider: results[0]!.provider
  };
}
