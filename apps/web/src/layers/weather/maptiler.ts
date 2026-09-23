import { API_BASE } from "../../lib/api";
import type { WeatherVisualizationId } from "./controls";

/**
 * Client side of the MapTiler Weather provider.
 *
 * MapTiler's weather variables are pre-rendered, animated tiles: the server proxy resolves the
 * keyframe for the requested time and streams the image, so here we only map a visualization to
 * a MapTiler variable, ask the proxy for the frame nearest to the timeline cursor, and hand the
 * tile template to the renderer.
 */
const MAPTILER_VARIABLE: Partial<Record<WeatherVisualizationId, string>> = {
  radar: "radar-composite:gfs",
  precipitation: "precipitation-1h:gfs",
  temperature: "temperature-2m:gfs",
  wind: "wind-10m:gfs",
  pressure: "pressure-msl:gfs"
};

export function maptilerVariable(visualization: WeatherVisualizationId): string | null {
  return MAPTILER_VARIABLE[visualization] ?? null;
}

const CATALOG_TTL_MS = 30 * 60_000;
let catalog: { at: number; byId: Map<string, number[]> } | null = null;

async function loadCatalog(signal?: AbortSignal): Promise<Map<string, number[]> | null> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.byId;
  try {
    const response = await fetch(`${API_BASE}/weather/maptiler/catalog`, { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { variables?: { id: string; frames: string[] }[] };
    const byId = new Map(
      (data.variables ?? []).map((variable) => [
        variable.id,
        (variable.frames ?? []).map((frame) => Date.parse(frame)).filter(Number.isFinite)
      ])
    );
    catalog = { at: Date.now(), byId };
    return byId;
  } catch {
    return null;
  }
}

export function __resetMaptilerCatalogForTests(): void {
  catalog = null;
}

export function nearestFrameIndex(frames: readonly number[], atMs: number): number {
  if (!frames.length) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < frames.length; index += 1) {
    const distance = Math.abs(frames[index]! - atMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

export interface MapTilerFrame {
  template: string;
  frame: number;
  tileSize: number;
  maxzoom: number;
}

/** Resolves the tile template for the frame closest to `at`. Returns null when the provider is
 *  unavailable (no key, no catalog) so the caller can fall back to the numeric grid. */
export async function mapTilerFrameFor(
  visualization: WeatherVisualizationId,
  at: string | null,
  signal?: AbortSignal
): Promise<MapTilerFrame | null> {
  const variableId = maptilerVariable(visualization);
  if (!variableId) return null;
  const byId = await loadCatalog(signal);
  if (!byId) return null;
  const frames = byId.get(variableId);
  if (!frames?.length) return null;
  const parsed = at ? Date.parse(at) : Number.NaN;
  const target = Number.isFinite(parsed) ? parsed : Date.now();
  const frame = nearestFrameIndex(frames, target);
  return {
    template: `${API_BASE}/weather/maptiler/${encodeURIComponent(variableId)}/${frame}/{z}/{x}/{y}.png`,
    frame,
    // MapTiler ships 512 px tiles down to zoom 3; MapLibre overzooms above that.
    tileSize: 512,
    maxzoom: 3
  };
}
