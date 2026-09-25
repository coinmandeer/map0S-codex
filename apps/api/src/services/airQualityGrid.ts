import type { Bbox } from "@mapos/layer-sdk";
import { fetchJson } from "../utils/upstream.js";
export const AIR_FIELDS = ["pm2_5", "pm10", "european_aqi"] as const;
type AirField = (typeof AIR_FIELDS)[number];
type Cell = { id: string; bbox: Bbox; lng: number; lat: number };
export function airCells(bbox: Bbox): {
  cells: Cell[];
  step: number;
  domain: "cams_europe" | "cams_global";
} {
  const [w, s, e, n] = bbox;
  if (
    ![w, s, e, n].every(Number.isFinite) ||
    w < -180 ||
    e > 180 ||
    s < -85 ||
    n > 85 ||
    w >= e ||
    s >= n
  )
    throw new Error("Invalid air grid bounds");
  const domain = w >= -25 && e <= 45 && s >= 34 && n <= 71 ? "cams_europe" : "cams_global";
  let step = domain === "cams_europe" ? 0.1 : 0.4;
  const bounds = () => [
    Math.floor((w + 180) / step),
    Math.floor((s + 90) / step),
    Math.ceil((e + 180) / step),
    Math.ceil((n + 90) / step)
  ];
  let [x0, y0, x1, y1] = bounds() as [number, number, number, number];
  while ((x1 - x0) * (y1 - y0) > 48) {
    step *= 2;
    [x0, y0, x1, y1] = bounds() as [number, number, number, number];
  }
  const cells: Cell[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const left = Math.max(-180, x * step - 180),
        bottom = Math.max(-85, y * step - 90);
      const right = Math.min(180, (x + 1) * step - 180),
        top = Math.min(85, (y + 1) * step - 90);
      cells.push({
        id: `${domain}:${step.toFixed(3)}:${x}:${y}`,
        bbox: [left, bottom, right, top],
        lng: (left + right) / 2,
        lat: (bottom + top) / 2
      });
    }
  return { cells, step, domain };
}
interface ModelResponse {
  hourly?: { time?: number[]; pm2_5?: unknown[]; pm10?: unknown[]; european_aqi?: unknown[] };
  hourly_units?: Record<string, string>;
}
export function readAirValues(
  response: ModelResponse,
  hour: number
): Record<AirField, number | null> {
  const index = response.hourly?.time?.indexOf(hour) ?? -1;
  return Object.fromEntries(
    AIR_FIELDS.map((field) => {
      const raw = index < 0 ? null : response.hourly?.[field]?.[index];
      const unit = response.hourly_units?.[field];
      const knownUnit =
        field === "european_aqi" ? unit === "EAQI" : unit === "μg/m³" || unit === "µg/m³";
      const valid = knownUnit && typeof raw === "number" && Number.isFinite(raw) && raw >= 0;
      return [field, valid ? raw : null];
    })
  ) as Record<AirField, number | null>;
}
/** Stable cells cache all three fields together. Zoom/field changes cannot turn station samples into a model. */
export function createAirQualityGrid(fetcher: typeof fetchJson = fetchJson, now = Date.now) {
  const cache = new Map<string, Record<AirField, number | null>>();
  return async (bbox: Bbox, signal?: AbortSignal) => {
    const { cells, step, domain } = airCells(bbox);
    const hour = Math.floor(now() / 3600000) * 3600;
    const cacheKey = (cell: Cell) => `${hour}:${cell.id}`;
    const missing = cells.filter((cell) => !cache.has(cacheKey(cell)));
    if (missing.length) {
      const day = new Date(hour * 1000).toISOString().slice(0, 10);
      const query = new URLSearchParams({
        latitude: missing.map((c) => c.lat.toFixed(6)).join(","),
        longitude: missing.map((c) => c.lng.toFixed(6)).join(","),
        hourly: AIR_FIELDS.join(","),
        domains: domain,
        timeformat: "unixtime",
        timezone: "GMT",
        start_date: day,
        end_date: day
      });
      const raw = await fetcher<ModelResponse | ModelResponse[]>(
        `https://air-quality-api.open-meteo.com/v1/air-quality?${query}`,
        {
          signal,
          providerId: "open-meteo-air-quality",
          ttlMs: 3600000,
          timeoutMs: 15000,
          maxResponseBytes: 512 * 1024,
          retries: 0
        }
      );
      signal?.throwIfAborted();
      const responses = Array.isArray(raw) ? raw : [raw];
      if (responses.length !== missing.length)
        throw new Error("CAMS returned an incomplete location array");
      for (let i = 0; i < missing.length; i++) {
        const values = readAirValues(responses[i]!, hour);
        // Missing hours are not a valid, cacheable zero measurement.
        if (AIR_FIELDS.some((field) => values[field] !== null))
          cache.set(cacheKey(missing[i]!), values);
      }
      while (cache.size > 2048) cache.delete(cache.keys().next().value!);
    }
    const result = cells.map((cell) => ({
      ...cell,
      values: cache.get(cacheKey(cell)) ?? { pm2_5: null, pm10: null, european_aqi: null }
    }));
    return {
      model: domain,
      sourceResolutionKm: domain === "cams_europe" ? 11 : 45,
      validAt: new Date(hour * 1000).toISOString(),
      displayCellDegrees: step,
      inputLocations: missing.length,
      cells: result,
      status: result.some((cell) => AIR_FIELDS.some((field) => cell.values[field] === null))
        ? "partial"
        : "complete",
      attribution:
        "CAMS ENSEMBLE · Open-Meteo · modelové hodnoty ve středu buněk, nikoli plošné měření"
    };
  };
}
export const getAirQualityGrid = createAirQualityGrid();
