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
import { fetchJson } from "../utils/upstream.js";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_MODELS = [
  "best_match",
  "icon_d2",
  "icon_seamless",
  "chmi_aladin_seamless"
] as const;
export type WeatherModelId = (typeof WEATHER_MODELS)[number];

/** Open-Meteo's models update hourly; a 15-minute cache bucket keeps panning cheap while still
 *  feeling live. */
const CACHE_BUCKET_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 240;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

/** One request per grid, so this is a hard cap on grid area, not a per-point budget.
 *  Raised from the original 144 so city-scale sectors resolve to individual cells instead of a
 *  handful of interpolated blobs. Open-Meteo accepts this many coordinates in a single call. */
export const MAX_GRID_POINTS = 400;
export const DEFAULT_GRID_COLS = 16;
export const DEFAULT_GRID_ROWS = 12;

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
  model?: WeatherModelId;
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
  median: number;
  sampleCount: number;
  /** Forecast/archive hour represented by the grid. */
  validAt: string;
  generatedAt: string;
}

/** Snapping the bbox to a coarse lattice means small pans reuse the same grid instead of
 *  re-querying on every map move. */
function snapBbox(bbox: Bbox): Bbox {
  const [w, s, e, n] = bbox;
  const span = Math.max(e - w, n - s, 0.05);
  const step = 2 ** Math.ceil(Math.log2(span / 8));
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
  hourly?: Record<string, string[] | number[] | undefined>;
}

const cache = new Map<string, { grid: WeatherGrid; bucket: number; bytes: number }>();

export function resetWeatherGridCache() {
  cache.clear();
  cacheBytes = 0;
}

function cacheGet(key: string, bucket: number): WeatherGrid | null {
  const hit = cache.get(key);
  if (!hit || hit.bucket !== bucket) return null;
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, hit);
  return hit.grid;
}

function cacheSet(key: string, bucket: number, grid: WeatherGrid) {
  cacheBytes -= cache.get(key)?.bytes ?? 0;
  const bytes = Buffer.byteLength(JSON.stringify(grid));
  cache.delete(key);
  cache.set(key, { grid, bucket, bytes });
  cacheBytes += bytes;
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
}

export interface WeatherGridQuery {
  model?: WeatherModelId;
  bbox: Bbox;
  variable: WeatherVariableId;
  cols?: number;
  rows?: number;
  at?: string | Date | number;
  signal?: AbortSignal;
}

function normalizeHour(at?: string | Date | number): Date {
  const parsed =
    at instanceof Date ? new Date(at.getTime()) : at === undefined ? new Date() : new Date(at);
  const safe = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  safe.setUTCMinutes(0, 0, 0);
  const now = Date.now();
  const min = now - 24 * 3600_000;
  const max = now + 7 * 24 * 3600_000;
  return new Date(Math.floor(Math.max(min, Math.min(max, safe.getTime())) / 3600_000) * 3600_000);
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export async function fetchWeatherGrid({
  bbox,
  variable,
  cols = DEFAULT_GRID_COLS,
  rows = DEFAULT_GRID_ROWS,
  at,
  signal,
  model = "best_match"
}: WeatherGridQuery): Promise<WeatherGrid> {
  if (!WEATHER_MODELS.includes(model)) throw new TypeError("Unsupported weather model");
  const spec = WEATHER_VARIABLES[variable];
  const { cols: safeCols, rows: safeRows } = clampGrid(cols, rows);
  const snapped = snapBbox(bbox);

  const targetHour = normalizeHour(at);
  const targetEpochHour = Math.floor(targetHour.getTime() / 3600_000);
  const bucket = Math.floor(Date.now() / CACHE_BUCKET_MS);
  const gridKey = (hour: number) =>
    `${model}:${variable}:${hour}:${safeCols}x${safeRows}:${snapped.join(",")}`;
  const key = gridKey(targetEpochHour);
  const cached = cacheGet(key, bucket);
  if (cached) return cached;

  signal?.throwIfAborted();
  const windowStart = Math.floor(targetEpochHour / 6) * 6;
  const isoHour = (hour: number) => new Date(hour * 3600_000).toISOString().slice(0, 16);
  const { lats, lngs } = gridPoints(snapped, safeCols, safeRows);
  const url =
    `${OPEN_METEO_URL}?latitude=${lats.join(",")}&longitude=${lngs.join(",")}` +
    `&hourly=${spec.fields.join(",")}&start_hour=${isoHour(windowStart)}&end_hour=${isoHour(windowStart + 5)}` +
    `&wind_speed_unit=ms&timezone=GMT&models=${model}`;

  const payload = await fetchJson<OpenMeteoPoint | OpenMeteoPoint[]>(url, {
    providerId: "weather-open-meteo-grid",
    // This module's bounded grid cache retains the decoded result. The shared client still
    // coalesces in-flight calls but should not retain a second copy of the large point array.
    ttlMs: 0,
    timeoutMs: 12_000,
    maxResponseBytes: 16 * 1024 * 1024,
    signal
  });
  const points = Array.isArray(payload) ? payload : [payload];

  let requestedGrid!: WeatherGrid;
  for (let hour = windowStart; hour < windowStart + 6; hour++) {
    const representedHour = new Date(hour * 3600_000);
    const values: (number | null)[] = [];
    const u: (number | null)[] = [];
    const v: (number | null)[] = [];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const numericValues: number[] = [];

    for (let i = 0; i < safeCols * safeRows; i += 1) {
      const hourly = points[i]?.hourly;
      const times = (hourly?.time ?? []) as string[];
      // Missing hours are unknown, never a neighbouring forecast labelled with the requested time.
      const hourIndex = times.findIndex(
        (time) =>
          Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(time) ? time : `${time}Z`) ===
          representedHour.getTime()
      );
      const primary = (hourly?.[spec.fields[0]!] as number[] | undefined)?.[hourIndex];
      const value = typeof primary === "number" && Number.isFinite(primary) ? primary : null;
      values.push(value);
      if (value !== null) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        numericValues.push(value);
      }

      if (spec.vector) {
        const direction = (hourly?.wind_direction_10m as number[] | undefined)?.[hourIndex];
        if (value !== null && typeof direction === "number" && Number.isFinite(direction)) {
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
      model,
      label: spec.label,
      unit: spec.unit,
      bbox: snapped,
      cols: safeCols,
      rows: safeRows,
      values,
      ...(spec.vector ? { u, v } : {}),
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      median: medianOf(numericValues),
      sampleCount: numericValues.length,
      validAt: representedHour.toISOString(),
      generatedAt: new Date().toISOString()
    };

    cacheSet(gridKey(hour), bucket, grid);
    if (hour === targetEpochHour) requestedGrid = grid;
  }
  return requestedGrid;
}
