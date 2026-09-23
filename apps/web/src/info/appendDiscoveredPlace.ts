import { applyPlanCommand, type Place, type PlanDocumentV2 } from "@mapos/layer-sdk";
import { createBlankPlanDocument } from "../planning/planDraft";
import { getMapStore } from "../store/mapStore";
import { MAX_INTERACTIVE_PLAN_STOPS } from "./placePlanAction";
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Pure canonical edit: only actual selected places, no inferred start or destination. */
export function appendDiscoveredPlace(
  document: PlanDocumentV2 | null,
  place: Pick<Place, "id" | "name" | "lng" | "lat">
): { plan: PlanDocumentV2; stopId: string } {
  if (document && document.stops.length >= MAX_INTERACTIVE_PLAN_STOPS)
    throw new RangeError("Stop limit");
  const stop = {
    id: id("stop"),
    name: place.name,
    location: { type: "Point" as const, coordinates: [place.lng, place.lat] as [number, number] },
    sourceFeatureId: place.id,
    dwellMinutes: 0,
    status: "accepted" as const
  };
  if (!document) {
    const base = createBlankPlanDocument(place.lng, place.lat);
    return {
      plan: {
        ...base,
        stops: [{ ...stop, order: 0 }],
        segments: [],
        metadata: { ...base.metadata, "dev.mapos.collectingStops": true }
      },
      stopId: stop.id
    };
  }
  return {
    plan: applyPlanCommand(document, {
      id: id("append"),
      expectedRevision: document.revision,
      command: { type: "add-stop", index: document.stops.length, stop }
    }).plan,
    stopId: stop.id
  };
}

export function addDiscoveredPlace(place: Pick<Place, "id" | "name" | "lng" | "lat">) {
  const store = getMapStore();
  try {
    const { plan, stopId } = appendDiscoveredPlace(store.activePlanDocument, place);
    store.setActivePlanDocument(plan);
    store.setRoutePreview(null);
    store.showToast("Zastávka přidána", {
      durationMs: 8000,
      secondaryAction: {
        label: "Otevřít plán",
        onSelect: () => {
          store.setMode("planning");
          store.setSidebarOpen(true);
        }
      },
      action: {
        label: "Vrátit",
        onSelect: () => {
          const current = store.activePlanDocument;
          if (
            !current ||
            current.id !== plan.id ||
            !current.stops.some((stop) => stop.id === stopId)
          )
            return;
          if (current.stops.length === 1) {
            if (current.revision !== plan.revision) {
              store.showToast("Plán byl mezitím upraven. Zastávku upravte v plánu.");
              return;
            }
            store.setActivePlanDocument(null);
          } else {
            store.setActivePlanDocument(
              applyPlanCommand(current, {
                id: id("undo-append"),
                expectedRevision: current.revision,
                command: { type: "remove-stop", stopId }
              }).plan
            );
          }
          store.setRoutePreview(null);
          store.showToast("Přidání zastávky vráceno");
        }
      }
    });
  } catch {
    store.showToast("Místo se nepodařilo přidat. Zkontrolujte počet zastávek v plánu.");
  }
}
