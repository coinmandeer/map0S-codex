/** Shared helpers for reading the numeric weather grids served by `/weather/grid`. */

import type { Bbox } from "@mapos/layer-sdk";

export type WeatherVariableId =
  "temperature" | "precipitation" | "wind" | "gusts" | "clouds" | "pressure" | "humidity";

export interface WeatherGrid {
  variable: WeatherVariableId;
  label: string;
  unit: string;
  bbox: Bbox;
  cols: number;
  rows: number;
  values: (number | null)[];
  u?: (number | null)[];
  v?: (number | null)[];
  min: number;
  max: number;
  median: number;
  sampleCount: number;
  validAt: string;
  generatedAt: string;
}

const MERCATOR_LIMIT = 85.05112878;

export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

export function mercatorYToLat(y: number): number {
  return (360 / Math.PI) * (Math.atan(Math.exp(y)) - Math.PI / 4);
}

/** Bilinear sample of a grid channel at a geographic position. Returns `null` outside the grid
 *  or where upstream had no data, so callers can leave those pixels transparent rather than
 *  inventing a value. */
export function sampleGrid(
  grid: WeatherGrid,
  channel: (number | null)[],
  lng: number,
  lat: number
): number | null {
  const [w, s, e, n] = grid.bbox;
  if (lng < w || lng > e || lat < s || lat > n) return null;

  const fx = ((lng - w) / (e - w || 1)) * (grid.cols - 1);
  // Grid rows run north to south.
  const fy = ((n - lat) / (n - s || 1)) * (grid.rows - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, grid.cols - 1);
  const y1 = Math.min(y0 + 1, grid.rows - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const at = (x: number, y: number) => channel[y * grid.cols + x] ?? null;
  const v00 = at(x0, y0);
  const v10 = at(x1, y0);
  const v01 = at(x0, y1);
  const v11 = at(x1, y1);
  if (v00 === null || v10 === null || v01 === null || v11 === null) return null;

  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}
