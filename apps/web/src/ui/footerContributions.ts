import type { LayerManifestV2, LegendManifestV2, TripPlan } from "@mapos/layer-sdk";

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

function hasValidDate(value: string | undefined): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

/**
 * Resolves footer time controls from declared capabilities instead of the current top-level mode.
 * A Planning or Game panel by itself is not temporal; a dated plan or active temporal layer is.
 */
export function timelineContributions(
  activeLayers: Record<string, VisibleLayerState>,
  activePlan: TripPlan | null,
  manifestFor: LayerManifestLookup
): TimelineContributionRef[] {
  const contributions: TimelineContributionRef[] = [];
  for (const [layerId, state] of Object.entries(activeLayers)) {
    if (!state.visible) continue;
    const temporal = manifestFor(layerId)?.temporal;
    if (!temporal?.enabled) continue;
    contributions.push({
      id: `layer:${layerId}`,
      kind: "layer",
      priority: temporal.timelinePriority ?? 0
    });
  }
  if (activePlan && hasValidDate(activePlan.departureAt)) {
    contributions.push({ id: `plan:${activePlan.id}`, kind: "dated-plan", priority: 100 });
  }
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
