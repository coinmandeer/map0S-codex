import { planV1ToV2, type PlanDocumentV2, type TripPlan } from "@mapos/layer-sdk";

function draftId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createBlankPlanDocument(
  lng: number,
  lat: number,
  now = new Date()
): PlanDocumentV2 {
  const departure = new Date(now.getTime() + 15 * 60_000);
  departure.setSeconds(0, 0);
  const plan: TripPlan = {
    id: draftId("plan"),
    name: "Nová cesta",
    departureAt: departure.toISOString(),
    variant: "fast",
    stops: [
      { id: draftId("start"), name: "Start", lng, lat, dwellMinutes: 0 },
      { id: draftId("finish"), name: "Cíl", lng: lng + 0.02, lat: lat + 0.01, dwellMinutes: 0 }
    ],
    vehicle: {
      profile: "car",
      heightM: null,
      widthM: null,
      weightT: null,
      fuel: "petrol",
      euroClass: null,
      evRangeKm: null
    },
    visibility: "private"
  };
  return planV1ToV2(plan, { now: now.toISOString() });
}
