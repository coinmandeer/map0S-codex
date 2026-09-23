import type { LayerManifestV2, LegendManifestV2, TripPlan } from "@mapos/layer-sdk";
import { isWeatherLayerId } from "../layers/weather/controls";

export interface VisibleLayerState {
  visible?: boolean;
}

export interface TimelineContributionRef {
  id: string;
  kind: "layer" | "dated-plan";
  priority: number;
}

export interface LegendContributionRef {
  id: string;
  layerId: string;
  title: string;
  legend: LegendManifestV2;
}

export type LayerManifestLookup = (layerId: string) => LayerManifestV2 | undefined;

/**
 * Resolves footer time controls from declared capabilities instead of the current top-level mode.
 * A Planning or Game panel by itself is not temporal; a dated plan or active temporal layer is.
 */
export function timelineContributions(
  activeLayers: Record<string, VisibleLayerState>,
  _activePlan: TripPlan | null,
  manifestFor: LayerManifestLookup
): TimelineContributionRef[] {
  const contributions: TimelineContributionRef[] = [];
  for (const [layerId, state] of Object.entries(activeLayers)) {
    if (!state.visible) continue;
    const temporal = manifestFor(layerId)?.temporal;
    if (!temporal?.enabled) continue;
    // A timestamp is not a working timeline controller. Keep this in sync with TimelineHost:
    // other sources expose period filters in the drawer until they have a rendered controller.
    if (
      layerId !== "weather" &&
      !isWeatherLayerId(layerId) &&
      layerId !== "events" &&
      !layerId.startsWith("theme-")
    )
      continue;
    contributions.push({
      id: `layer:${layerId}`,
      kind: "layer",
      priority: temporal.timelinePriority ?? 0
    });
  }
  // A departure time remains part of the plan; it does not create an otherwise inert map
  // scrubber. Only active temporal data (weather/events) earns space in the map footer.
  return contributions.sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id)
  );
}

/** Active manifest legends form one stack; hiding the stack never changes layer visibility. */
export function legendContributions(
  activeLayers: Record<string, VisibleLayerState>,
  manifestFor: LayerManifestLookup
): LegendContributionRef[] {
  return Object.entries(activeLayers).flatMap(([layerId, state]) => {
    if (!state.visible) return [];
    const manifest = manifestFor(layerId);
    if (!manifest?.legend) return [];
    return [
      {
        id: `legend:${layerId}`,
        layerId,
        title: manifest.legend.title ?? manifest.name,
        legend: manifest.legend
      }
    ];
  });
}
