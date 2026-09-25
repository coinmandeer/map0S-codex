export type TravelMatrix = readonly (readonly number[])[];
/** Preserve all existing stop order, including locked stops and endpoints. */
export function cheapestInsertion(
  matrix: TravelMatrix,
  order: readonly number[],
  candidate: number
): { index: number; extraSeconds: number } | null {
  let best: { index: number; extraSeconds: number } | null = null;
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1]!,
      b = order[i]!,
      old = matrix[a]?.[b] ?? Infinity;
    const cost = (matrix[a]?.[candidate] ?? Infinity) + (matrix[candidate]?.[b] ?? Infinity) - old;
    if (Number.isFinite(cost) && (!best || cost < best.extraSeconds))
      best = { index: i, extraSeconds: cost };
  }
  return best;
}
/** Greedy minimum detour insertion followed by bounded 2-opt, with fixed access point. */
export function walkingLoop(
  matrix: TravelMatrix,
  maxSeconds = 4 * 3600,
  dwellSeconds = 15 * 60
): number[] {
  if (matrix.length < 2 || matrix.length > 10) return [];
  const route = [0, 0],
    remaining = new Set(Array.from({ length: matrix.length - 1 }, (_, i) => i + 1));
  const duration = (order: readonly number[]) =>
    order.slice(1).reduce((sum, to, i) => sum + (matrix[order[i]!]![to] ?? Infinity), 0) +
    Math.max(0, order.length - 2) * dwellSeconds;
  while (remaining.size) {
    let best: { candidate: number; index: number; cost: number } | null = null;
    for (const candidate of remaining) {
      const insertion = cheapestInsertion(matrix, route, candidate);
      if (
        insertion &&
        duration(route) + insertion.extraSeconds + dwellSeconds <= maxSeconds &&
        (!best || insertion.extraSeconds < best.cost)
      )
        best = { candidate, index: insertion.index, cost: insertion.extraSeconds };
    }
    if (!best) break;
    route.splice(best.index, 0, best.candidate);
    remaining.delete(best.candidate);
    if (duration(route) >= 3 * 3600 && route.length >= 4) break;
  }
  for (let pass = 0; pass < 3; pass++)
    for (let a = 1; a < route.length - 2; a++)
      for (let b = a + 1; b < route.length - 1; b++) {
        const next = [
          ...route.slice(0, a),
          ...route.slice(a, b + 1).reverse(),
          ...route.slice(b + 1)
        ];
        if (duration(next) + 1 < duration(route)) route.splice(0, route.length, ...next);
      }
  return route.length >= 3 ? route : [];
}
