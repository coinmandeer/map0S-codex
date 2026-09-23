/** Small numeric bathymetry grids for the map overlay.
 *
 * EMODnet exposes a colour WMS, but its pixels cannot be labelled with a depth. This adapter
 * samples the same authoritative layer through GetFeatureInfo, caches the compact result, and
 * returns null over land or outside coverage. The browser can therefore render the same
 * zoom-aware cells and median labels as the weather overlay without downloading a raster. */
import type { Bbox } from "@mapos/layer-sdk";
import { fetchJson } from "../utils/upstream.js";

const ENDPOINT = "https://ows.emodnet-bathymetry.eu/wms";
const CACHE_TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 80;
const cache = new Map<string, { value: BathymetryGrid; expiresAt: number }>();

export interface BathymetryGrid {
  variable: "depth";
  label: "Hloubka moře";
  unit: "m";
  bbox: Bbox;
  cols: number;
  rows: number;
  /** Positive metres below mean sea level; null means no bathymetry at the sample. */
  values: (number | null)[];
  min: number;
  max: number;
  median: number;
  sampleCount: number;
  validAt: string;
  generatedAt: string;
}

function safeDimensions(cols = 6, rows = 4): { cols: number; rows: number } {
  const c = Math.max(2, Math.min(8, Math.round(cols) || 6));
  const r = Math.max(2, Math.min(6, Math.round(rows) || 4));
  return c * r <= 48 ? { cols: c, rows: r } : { cols: 6, rows: 4 };
}

function samplePoint(bbox: Bbox, cols: number, rows: number, index: number): [number, number] {
  const [west, south, east, north] = bbox;
  const row = Math.floor(index / cols);
  const col = index % cols;
  return [
    west + ((east - west) * (col + 0.5)) / cols,
    north - ((north - south) * (row + 0.5)) / rows
  ];
}

async function readDepth(
  bbox: Bbox,
  lng: number,
  lat: number,
  signal?: AbortSignal
): Promise<number | null> {
  const [west, south, east, north] = bbox;
  const x = 128;
  const y = 128;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: "emodnet:mean",
    QUERY_LAYERS: "emodnet:mean",
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: `${Math.max(-180, lng - (east - west) / 512)},${Math.max(-90, lat - (north - south) / 512)},${Math.min(180, lng + (east - west) / 512)},${Math.min(90, lat + (north - south) / 512)}`,
    WIDTH: "256",
    HEIGHT: "256",
    X: String(x),
    Y: String(y),
    INFO_FORMAT: "application/json",
    FEATURE_COUNT: "1"
  });
  try {
    const result = await fetchJson<{ features?: Array<{ properties?: { Depth?: unknown } }> }>(
      `${ENDPOINT}?${params}`,
      {
        providerId: "emodnet-bathymetry-grid",
        ttlMs: CACHE_TTL_MS,
        timeoutMs: 8_000,
        maxResponseBytes: 256 * 1024,
        signal
      }
    );
    const value = result.features?.[0]?.properties?.Depth;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
  } catch {
    return null;
  }
}

export async function fetchBathymetryGrid({
  bbox,
  cols,
  rows,
  signal
}: {
  bbox: Bbox;
  cols?: number;
  rows?: number;
  signal?: AbortSignal;
}): Promise<BathymetryGrid> {
  const safeBbox: Bbox = [
    Math.max(-180, Math.min(180, bbox[0])),
    Math.max(-85, Math.min(85, bbox[1])),
    Math.max(-180, Math.min(180, bbox[2])),
    Math.max(-85, Math.min(85, bbox[3]))
  ];
  const dims = safeDimensions(cols, rows);
  const key = `${safeBbox.map((v) => v.toFixed(3)).join(",")}:${dims.cols}x${dims.rows}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  cache.delete(key);

  const values: (number | null)[] = Array.from({ length: dims.cols * dims.rows }, () => null);
  let next = 0;
  // Four in-flight probes keeps an interactive map responsive and is still one compact cached
  // answer from the user's point of view.
  await Promise.all(
    Array.from({ length: Math.min(4, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        const [lng, lat] = samplePoint(safeBbox, dims.cols, dims.rows, index);
        values[index] = await readDepth(safeBbox, lng, lat, signal);
      }
    })
  );
  const numbers = values.filter((value): value is number => typeof value === "number");
  const sorted = [...numbers].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    : 0;
  const result: BathymetryGrid = {
    variable: "depth",
    label: "Hloubka moře",
    unit: "m",
    bbox: safeBbox,
    cols: dims.cols,
    rows: dims.rows,
    values,
    min: numbers.length ? Math.min(...numbers) : 0,
    max: numbers.length ? Math.max(...numbers) : 0,
    median,
    sampleCount: numbers.length,
    validAt: new Date().toISOString(),
    generatedAt: new Date().toISOString()
  };
  cache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return result;
}

export function resetBathymetryGridCache(): void {
  cache.clear();
}
