import type { RouteAlternativeV2, RouteSegmentV2 } from "@mapos/layer-sdk";

/** Kept tiny to avoid coupling the API service to the browser presentation helper. */
export function selectedPlanAlternative(segment: RouteSegmentV2): RouteAlternativeV2 | null {
  return (
    segment.alternatives.find((alternative) => alternative.id === segment.selectedAlternativeId) ??
    null
  );
}
