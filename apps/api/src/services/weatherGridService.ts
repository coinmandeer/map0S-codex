/** Numeric weather grids from Open-Meteo, the data behind the Windy-style overlays.
 *
 *  The existing weather layer is raster-only: RainViewer radar plus OpenWeatherMap tiles that
 *  arrive pre-coloured in someone else's washed-out palette, and with no way to draw wind at all.
 *  Fetching raw numbers instead lets the client paint its own vivid ramps and advect wind
 *  particles — and Open-Meteo needs no API key, so this works on a fresh clone.
 *
 *  Open-Meteo accepts many coordinates per request, so one call covers a whole grid.
 */

import type { Bbox } from "@mapos/layer-sdk";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

/** Open-Meteo's models update hourly; a 15-minute cache bucket keeps panning cheap while still
 *  feeling live. */
const CACHE_BUCKET_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 120;

/** One request per grid, so this is a hard cap on grid area, not a per-point budget. */
export const MAX_GRID_POINTS = 144;
export const DEFAULT_GRID_COLS = 11;
export const DEFAULT_GRID_ROWS = 9;

export type WeatherVariableId =
  "temperature" | "precipitation" | "wind" | "gusts" | "clouds" | "pressure" | "humidity";

interface VariableSpec {
  /** Open-Meteo `current=` fields this variable needs. */
  fields: string[];
  unit: string;
  label: string;
  /** Wind carries direction too and is rendered as a flow field rather than a flat scalar. */
  vector?: boolean;
}

export const WEATHER_VARIABLES: Record<WeatherVariableId, VariableSpec> = {
  temperature: { fields: ["temperature_2m"], unit: "°C", label: "Teplota" },
  precipitation: { fields: ["precipitation"], unit: "mm", label: "Srážky" },
  wind: {
    fields: ["wind_speed_10m", "wind_direction_10m"],
    unit: "m/s",
    label: "Vítr",
    vector: true
  },
  gusts: { fields: ["wind_gusts_10m"], unit: "m/s", label: "Nárazy" },
  clouds: { fields: ["cloud_cover"], unit: "%", label: "Oblačnost" },
  pressure: { fields: ["pressure_msl"], unit: "hPa", label: "Tlak" },
  humidity: { fields: ["relative_humidity_2m"], unit: "%", label: "Vlhkost" }
};

export function isWeatherVariable(value: string): value is WeatherVariableId {
  return value in WEATHER_VARIABLES;
}

export interface WeatherGrid {
  variable: WeatherVariableId;
  label: string;
  unit: string;
  /** The snapped bbox actually sampled, which is what the client must georeference against. */
  bbox: Bbox;
  cols: number;
  rows: number;
  /** Row-major, north-to-south, west-to-east. `null` where upstream had no value. */
  values: (number | null)[];
  /** Wind only: eastward/northward components in m/s, same ordering as `values`. */
  u?: (number | null)[];
  v?: (number | null)[];
  min: number;
  max: number;
  generatedAt: string;
}

/** Snapping the bbox to a coarse lattice means small pans reuse the same grid instead of
 *  re-querying on every map move. */
function snapBbox(bbox: Bbox): Bbox {
  const [w, s, e, n] = bbox;
  const span = Math.max(e - w, n - s, 0.05);
  const step = span / 8;
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  return [
    Math.max(-180, Number(down(w).toFixed(4))),
    Math.max(-85, Number(down(s).toFixed(4))),
    Math.min(180, Number(up(e).toFixed(4))),
    Math.min(85, Number(up(n).toFixed(4)))
  ];
}

/** Keeps the point count under `MAX_GRID_POINTS` while preserving the requested aspect ratio,
 *  so an oversized request degrades into a coarser grid rather than a rejected one. */
function clampGrid(cols: number, rows: number): { cols: number; rows: number } {
  let c = Math.max(2, Math.min(Math.round(cols) || DEFAULT_GRID_COLS, MAX_GRID_POINTS));
  let r = Math.max(2, Math.min(Math.round(rows) || DEFAULT_GRID_ROWS, MAX_GRID_POINTS));
  if (c * r > MAX_GRID_POINTS) {
    const scale = Math.sqrt(MAX_GRID_POINTS / (c * r));
    c = Math.max(2, Math.floor(c * scale));
    r = Math.max(2, Math.floor(MAX_GRID_POINTS / c));
  }
  return { cols: c, rows: r };
}

function gridPoints(bbox: Bbox, cols: number, rows: number) {
  const [w, s, e, n] = bbox;
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    // North-to-south so the array can be blitted straight into an image.
    const lat = rows === 1 ? (n + s) / 2 : n - ((n - s) * row) / (rows - 1);
    for (let col = 0; col < cols; col += 1) {
      const lng = cols === 1 ? (w + e) / 2 : w + ((e - w) * col) / (cols - 1);
      lats.push(Number(lat.toFixed(4)));
      lngs.push(Number(lng.toFixed(4)));
    }
  }
  return { lats, lngs };
}

interface OpenMeteoPoint {
  current?: Record<string, number | string | undefined>;
}

const cache = new Map<string, { grid: WeatherGrid; bucket: number }>();

function cacheGet(key: string, bucket: number): WeatherGrid | null {
  const hit = cache.get(key);
  if (!hit || hit.bucket !== bucket) return null;
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, hit);
  return hit.grid;
}

function cacheSet(key: string, bucket: number, grid: WeatherGrid) {
  cache.set(key, { grid, bucket });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export interface WeatherGridQuery {
  bbox: Bbox;
  variable: WeatherVariableId;
  cols?: number;
  rows?: number;
  signal?: AbortSignal;
}

export async function fetchWeatherGrid({
  bbox,
  variable,
  cols = DEFAULT_GRID_COLS,
  rows = DEFAULT_GRID_ROWS,
  signal
}: WeatherGridQuery): Promise<WeatherGrid> {
  const spec = WEATHER_VARIABLES[variable];
  const { cols: safeCols, rows: safeRows } = clampGrid(cols, rows);
  const snapped = snapBbox(bbox);

  const bucket = Math.floor(Date.now() / CACHE_BUCKET_MS);
  const key = `${variable}:${safeCols}x${safeRows}:${snapped.join(",")}`;
  const cached = cacheGet(key, bucket);
  if (cached) return cached;

  const { lats, lngs } = gridPoints(snapped, safeCols, safeRows);
  const url =
    `${OPEN_METEO_URL}?latitude=${lats.join(",")}&longitude=${lngs.join(",")}` +
    `&current=${spec.fields.join(",")}&wind_speed_unit=ms&timezone=GMT`;

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);

  const payload = (await response.json()) as OpenMeteoPoint | OpenMeteoPoint[];
  const points = Array.isArray(payload) ? payload : [payload];

  const values: (number | null)[] = [];
  const u: (number | null)[] = [];
  const v: (number | null)[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < safeCols * safeRows; i += 1) {
    const current = points[i]?.current;
    const primary = current?.[spec.fields[0]!];
    const value = typeof primary === "number" ? primary : null;
    values.push(value);
    if (value !== null) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    if (spec.vector) {
      const direction = current?.["wind_direction_10m"];
      if (value !== null && typeof direction === "number") {
        // Meteorological convention: direction is where the wind blows *from*.
        const rad = ((direction + 180) * Math.PI) / 180;
        u.push(value * Math.sin(rad));
        v.push(value * Math.cos(rad));
      } else {
        u.push(null);
        v.push(null);
      }
    }
  }

  const grid: WeatherGrid = {
    variable,
    label: spec.label,
    unit: spec.unit,
    bbox: snapped,
    cols: safeCols,
    rows: safeRows,
    values,
    ...(spec.vector ? { u, v } : {}),
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    generatedAt: new Date().toISOString()
  };

  cacheSet(key, bucket, grid);
  return grid;
}
