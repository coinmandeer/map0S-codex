import type { FilterValues } from "@mapos/layer-sdk";
import { resolveWeatherVisualization } from "./controls";

export function nearestRadarFrame(
  cursorMs: number,
  frames: readonly number[],
  nowMs: number
): number | null {
  if (cursorMs >= nowMs - 30 * 60_000 || frames.length === 0) return null;
  const cursorSeconds = Math.floor(cursorMs / 1000);
  return frames.reduce((best, frame) =>
    Math.abs(frame - cursorSeconds) < Math.abs(best - cursorSeconds) ? frame : best
  );
}

export function weatherTimelinePatch(
  filters: FilterValues,
  cursor: string,
  frames: readonly number[],
  nowMs = Date.now()
): FilterValues {
  const cursorMs = Date.parse(cursor);
  const visualization = resolveWeatherVisualization(filters);
  return {
    at: cursor,
    frameTs:
      visualization === "radar" && Number.isFinite(cursorMs)
        ? nearestRadarFrame(cursorMs, frames, nowMs)
        : null
  };
}

export function filterPatchChanges(filters: FilterValues, patch: FilterValues): boolean {
  return Object.entries(patch).some(([key, value]) => !Object.is(filters[key], value));
}
