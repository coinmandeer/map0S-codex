import type { Bbox, FilterValues } from "@mapos/layer-sdk";
import { resolveWeatherVisualization, type WeatherVisualizationId } from "./controls";
import type { WeatherVariableId } from "./grid";

export type WeatherRepresentation =
  "continuous-grid" | "cells" | "numeric-sectors" | "smooth-field";

export interface WeatherRenderBudget {
  id: "regional" | "cells-coarse" | "cells-fine" | "local";
  minZoom: number;
  maxZoomExclusive: number;
  representation: WeatherRepresentation;
  maxGridSamples: number;
  maxRenderedCells: number;
  maxNumericLabels: number;
  targetCellAreaKm2: 50 | 25 | 10;
}

/** Provider/renderer capability contract, deliberately outside React components.
 * The API caps a grid at 400 samples; every viewport budget stays below that bound. */
export const WEATHER_RENDER_BUDGETS: readonly WeatherRenderBudget[] = [
  {
    id: "regional",
    minZoom: 0,
    maxZoomExclusive: 6.5,
    representation: "continuous-grid",
    maxGridSamples: 240,
    maxRenderedCells: 0,
    maxNumericLabels: 24,
    targetCellAreaKm2: 50
  },
  {
    id: "cells-coarse",
    minZoom: 6.5,
    maxZoomExclusive: 8.5,
    representation: "smooth-field",
    maxGridSamples: 320,
    maxRenderedCells: 320,
    maxNumericLabels: 64,
    targetCellAreaKm2: 25
  },
  {
    id: "cells-fine",
    minZoom: 8.5,
    maxZoomExclusive: 10.5,
    representation: "smooth-field",
    maxGridSamples: 400,
    maxRenderedCells: 480,
    maxNumericLabels: 120,
    targetCellAreaKm2: 10
  },
  {
    id: "local",
    minZoom: 10.5,
    maxZoomExclusive: Number.POSITIVE_INFINITY,
    representation: "smooth-field",
    maxGridSamples: 400,
    maxRenderedCells: 240,
    maxNumericLabels: 120,
    targetCellAreaKm2: 10
  }
] as const;

/** Network and interaction ceilings for a single active weather contribution. */
export const WEATHER_RUNTIME_BUDGET = {
  maxConcurrentGridRequests: 1,
  maxGridSamplesPerRequest: 400,
  maxAdjacentTimelineFrames: 1,
  timelineCommitDelayMs: 240,
  liveRadarMetadataTtlMs: 10 * 60_000,
  liveRadarNegativeTtlMs: 30_000,
  radarTileMaxZoom: 5
} as const;

export interface WeatherZoomStrategy extends WeatherRenderBudget {
  cols: number;
  rows: number;
  estimatedViewportAreaKm2: number | null;
  plannedCellAreaKm2: number | null;
}

function dimensions(
  maxSamples: number,
  viewportWidth: number,
  viewportHeight: number,
  desiredSamples = maxSamples
) {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const aspect = Math.max(0.5, Math.min(2, width / height));
  const target = Math.max(16, Math.min(maxSamples, Math.ceil(desiredSamples)));
  let cols = Math.max(2, Math.min(20, Math.floor(Math.sqrt(target * aspect))));
  let rows = Math.max(2, Math.min(20, Math.floor(target / cols)));
  while (cols * rows > maxSamples && rows > 2) rows -= 1;
  while ((cols + 1) * rows <= target && cols < 20) cols += 1;
  return { cols, rows };
}

function viewportAreaKm2(bbox: Bbox | undefined): number | null {
  if (!bbox) return null;
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) {
    return null;
  }
  const midLatRadians = (((south + north) / 2) * Math.PI) / 180;
  const widthKm = (east - west) * 111.32 * Math.max(0.05, Math.cos(midLatRadians));
  const heightKm = (north - south) * 110.57;
  return Math.max(0, widthKm * heightKm);
}

export function resolveWeatherZoomStrategy(
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  bbox?: Bbox
): WeatherZoomStrategy {
  const safeZoom = Number.isFinite(zoom) ? Math.max(0, zoom) : 0;
  const budget =
    WEATHER_RENDER_BUDGETS.find(
      (candidate) => safeZoom >= candidate.minZoom && safeZoom < candidate.maxZoomExclusive
    ) ?? WEATHER_RENDER_BUDGETS[WEATHER_RENDER_BUDGETS.length - 1]!;
  const estimatedViewportAreaKm2 = viewportAreaKm2(bbox);
  const desiredSamples =
    estimatedViewportAreaKm2 === null
      ? budget.maxGridSamples
      : estimatedViewportAreaKm2 /
        (budget.targetCellAreaKm2 * (budget.representation === "cells" ? 2 : 1));
  const resolved = dimensions(budget.maxGridSamples, viewportWidth, viewportHeight, desiredSamples);
  return {
    ...budget,
    ...resolved,
    estimatedViewportAreaKm2,
    plannedCellAreaKm2:
      estimatedViewportAreaKm2 === null
        ? null
        : estimatedViewportAreaKm2 / (resolved.cols * resolved.rows)
  };
}

export type WeatherUpdatePlan =
  | { kind: "inactive"; visualization: WeatherVisualizationId }
  | { kind: "unavailable"; visualization: "radar"; reason: "radar-has-no-forecast" }
  | { kind: "radar"; visualization: "radar" }
  | {
      kind: "grid";
      visualization: WeatherVariableId;
      variable: WeatherVariableId;
      strategy: WeatherZoomStrategy;
      animateWind: boolean;
    };

/** Pure request plan used by the layer lifecycle and its no-network contract tests. */
export function weatherUpdatePlan(input: {
  active: boolean;
  filters: FilterValues;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  bbox?: Bbox;
  nowMs?: number;
}): WeatherUpdatePlan {
  const visualization = resolveWeatherVisualization(input.filters);
  if (!input.active) return { kind: "inactive", visualization };

  if (visualization === "radar") {
    const at = typeof input.filters.at === "string" ? Date.parse(input.filters.at) : Number.NaN;
    const future = Number.isFinite(at) && at > (input.nowMs ?? Date.now()) + 30 * 60_000;
    return future
      ? { kind: "unavailable", visualization, reason: "radar-has-no-forecast" }
      : { kind: "radar", visualization };
  }

  const strategy = resolveWeatherZoomStrategy(
    input.zoom,
    input.viewportWidth,
    input.viewportHeight,
    input.bbox
  );
  return {
    kind: "grid",
    visualization,
    variable: visualization,
    strategy,
    // Wind is the one variable whose motion carries meaning, so the flow field is animated at
    // every zoom where a grid is drawn — not just the continuous regional view.
    animateWind: visualization === "wind"
  };
}
