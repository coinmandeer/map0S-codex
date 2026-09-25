import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { point, type DataSource } from "./types.js";
export interface AuroraGrid {
  "Observation Time": string;
  "Forecast Time": string;
  coordinates: [number, number, number][];
}
/** Bound the global grid while retaining true source values, including zero and polar cells. */
export function auroraFeatures(grid: AuroraGrid, bbox: Bbox, now = Date.now()): GeoFeature[] {
  const observation = Date.parse(grid["Observation Time"]),
    forecast = Date.parse(grid["Forecast Time"]);
  if (
    !Number.isFinite(observation) ||
    !Number.isFinite(forecast) ||
    observation > now + 3600000 ||
    now - observation > 3 * 3600000
  )
    throw new Error("Předpověď polární záře je zastaralá nebo neplatná");
  if (!Array.isArray(grid.coordinates) || grid.coordinates.length > 70000)
    throw new Error("Neplatná mřížka NOAA");
  const step = Math.max(
    1,
    Math.ceil(Math.sqrt(((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / 1500))
  );
  const cells = new Map<string, { west: number; south: number; value: number }>();
  for (const sample of grid.coordinates) {
    if (!Array.isArray(sample) || sample.length !== 3 || !sample.every(Number.isFinite)) continue;
    const [rawLng, lat, value] = sample;
    if (rawLng < 0 || rawLng > 360 || lat < -90 || lat > 90 || value < 0 || value > 100) continue;
    const lng = rawLng >= 180 ? rawLng - 360 : rawLng;
    if (
      lng < bbox[0] - step ||
      lng > bbox[2] + step ||
      lat < bbox[1] - step ||
      lat > bbox[3] + step
    )
      continue;
    const west = Math.floor((lng + 180) / step) * step - 180;
    const south = Math.min(180 - step, Math.floor((lat + 90) / step) * step) - 90;
    const key = `${west}:${south}`;
    const previous = cells.get(key);
    if (!previous || previous.value < value) cells.set(key, { west, south, value });
  }
  return [...cells.values()].map(({ west, south, value }) => {
    const east = Math.min(180, west + step),
      north = Math.min(90, south + step);
    return point(
      `noaa-aurora:${west}:${south}:${step}`,
      `Polární záře · ${value} %`,
      (west + east) / 2,
      (south + north) / 2,
      "aurora",
      {
        probability: value,
        unit: "%",
        cellBounds: [west, south, east, north],
        resolutionDegrees: step,
        aggregation: step > 1 ? "maximum" : "source-grid",
        observedAt: grid["Observation Time"],
        forecastAt: grid["Forecast Time"],
        sourceId: "noaa-swpc",
        source: "NOAA SWPC · OVATION",
        website: "https://www.spaceweather.gov/products/aurora-30-minute-forecast",
        description: `Modelový odhad pro ${grid["Forecast Time"]}. ${step > 1 ? `Maximum v buňce ${step}°.` : "Mřížka 1°."} Nezohledňuje místní oblačnost, denní světlo ani světelné znečištění.`
      }
    );
  });
}
export const aurora: DataSource = {
  id: "aurora",
  async load(bbox, _query, signal) {
    const grid = await fetchJson<AuroraGrid>(
      "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
      {
        providerId: "noaa-swpc",
        ttlMs: 5 * 60000,
        timeoutMs: 10000,
        minIntervalMs: 1000,
        maxResponseBytes: 3 * 1024 * 1024,
        signal
      }
    );
    return auroraFeatures(grid, bbox);
  }
};
