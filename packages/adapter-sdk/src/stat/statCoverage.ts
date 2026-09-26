export type CoverageBbox = [number, number, number, number];

/** The zooms at which the statistical dataset choice changes (country → NUTS → LAU), each with a
 *  grid about a sixth of a typical screen at that zoom. */
const ZOOM_BANDS = [
  { min: 8, grid: 0.25 },
  { min: 6, grid: 1 },
  { min: 4, grid: 2.5 },
  { min: 0, grid: 10 }
] as const;

/**
 * The catalogue coverage question a view asks: the zoom band the dataset choice follows and the
 * view snapped outward to that band's grid. The server computes and caches coverage per answer,
 * and the client asks with the same key, so neighbouring views share one computation and a pan
 * back is answered from the browser cache. The snapped area can be slightly larger than the
 * view, which only makes a coverage dot conservative.
 */
export function statCoverageRequest(
  bbox: readonly number[] | null,
  zoom = 0
): { bbox: CoverageBbox | null; zoom: number } {
  const band = ZOOM_BANDS.find((entry) => zoom >= entry.min) ?? ZOOM_BANDS[ZOOM_BANDS.length - 1]!;
  if (!bbox || bbox.length !== 4) return { bbox: null, zoom: band.min };
  const snap = (value: number, round: (value: number) => number) =>
    Number((round(value / band.grid) * band.grid).toFixed(6));
  const [w, s, e, n] = bbox as CoverageBbox;
  return {
    bbox: [
      Math.max(-180, snap(w, Math.floor)),
      Math.max(-90, snap(s, Math.floor)),
      Math.min(180, snap(e, Math.ceil)),
      Math.min(90, snap(n, Math.ceil))
    ],
    zoom: band.min
  };
}
