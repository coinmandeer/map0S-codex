import type {
  PlanDocumentV2,
  Position,
  RouteAlternativeV2,
  RouteSegmentV2
} from "@mapos/layer-sdk";

export interface PlanSegmentSummary {
  distanceM: number;
  durationS: number;
  ready: number;
  failed: number;
  stale: number;
}

export interface PlanRoutePreview {
  coordinates: Position[];
  distanceM: number;
  durationS: number;
}

export interface PlanRouteSegmentPreview extends PlanRoutePreview {
  id: string;
  order: number;
}

export function selectedPlanAlternative(segment: RouteSegmentV2): RouteAlternativeV2 | null {
  return (
    segment.alternatives.find((alternative) => alternative.id === segment.selectedAlternativeId) ??
    null
  );
}

export function summarizePlanSegments(document: PlanDocumentV2): PlanSegmentSummary {
  const alternatives = document.segments
    .map(selectedPlanAlternative)
    .filter((value): value is RouteAlternativeV2 => Boolean(value));
  return {
    distanceM: alternatives.reduce((sum, alternative) => sum + alternative.distanceM, 0),
    durationS: alternatives.reduce((sum, alternative) => sum + alternative.durationS, 0),
    ready: document.segments.filter(
      (segment) => segment.status === "ready" || segment.status === "partial"
    ).length,
    failed: document.segments.filter((segment) => segment.status === "failed").length,
    stale: document.segments.filter((segment) =>
      ["pending", "routing", "stale"].includes(segment.status)
    ).length
  };
}

/** Keep every real routed neighbour as its own map feature. This makes the composed route
 * selectable without ever manufacturing a line across a failed or unresolved segment. */
export function routableSegmentPreviews(document: PlanDocumentV2): PlanRouteSegmentPreview[] {
  return document.segments.flatMap((segment) => {
    const alternative = selectedPlanAlternative(segment);
    if (!alternative || (segment.status !== "ready" && segment.status !== "partial")) return [];
    return [
      {
        id: segment.id,
        order: segment.order,
        coordinates: alternative.geometry.coordinates.map((position) => [...position] as Position),
        distanceM: alternative.distanceM,
        durationS: alternative.durationS
      }
    ];
  });
}

/**
 * A failed segment is a real gap. Preview only the longest contiguous successful part so the map
 * never draws a misleading straight connection through that gap.
 */
export function longestRoutablePreview(document: PlanDocumentV2): PlanRoutePreview | null {
  let longest: PlanRoutePreview | null = null;
  let current: PlanRoutePreview | null = null;
  const finishGroup = () => {
    if (current && (!longest || current.coordinates.length > longest.coordinates.length)) {
      longest = current;
    }
    current = null;
  };

  const previewsByOrder = new Map(
    routableSegmentPreviews(document).map((preview) => [preview.order, preview])
  );
  for (const segment of document.segments) {
    const preview = previewsByOrder.get(segment.order);
    if (!preview) {
      finishGroup();
      continue;
    }
    if (!current) {
      current = {
        coordinates: preview.coordinates.map((position) => [...position] as Position),
        distanceM: preview.distanceM,
        durationS: preview.durationS
      };
      continue;
    }
    current.coordinates.push(
      ...preview.coordinates.slice(1).map((position) => [...position] as Position)
    );
    current.distanceM += preview.distanceM;
    current.durationS += preview.durationS;
  }
  finishGroup();
  return longest;
}
