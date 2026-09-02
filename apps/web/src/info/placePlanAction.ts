import { applyPlanCommand, type Place, type PlanDocumentV2 } from "@mapos/layer-sdk";

export const MAX_INTERACTIVE_PLAN_STOPS = 250;

/** Inserts a place immediately before the plan's destination and keeps its stable feature id.
 * Persistence remains an explicit Planning action; opening a detail never writes a plan remotely. */
export function addPlaceToPlanDocument(
  document: PlanDocumentV2,
  place: Pick<Place, "id" | "name" | "lng" | "lat">,
  idFactory: (prefix: string) => string
): PlanDocumentV2 {
  if (document.stops.length >= MAX_INTERACTIVE_PLAN_STOPS) {
    throw new RangeError("Interactive plan stop limit reached");
  }
  return applyPlanCommand(document, {
    id: idFactory("place-command"),
    expectedRevision: document.revision,
    command: {
      type: "add-stop",
      index: document.stops.length - 1,
      stop: {
        id: idFactory("place-stop"),
        name: place.name,
        location: { type: "Point", coordinates: [place.lng, place.lat] },
        sourceFeatureId: place.id,
        dwellMinutes: 20,
        status: "accepted"
      }
    }
  }).plan;
}
