import type { PlanDocumentV2 } from "@mapos/layer-sdk";

function distance(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} km` : `${Math.round(value)} m`;
}

function duration(value: number): string {
  const minutes = Math.round(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** Human-readable, provider-neutral itinerary suitable for clipboard and native sharing. */
export function buildPlanItinerary(plan: PlanDocumentV2): string {
  const lines = [plan.name];
  if (plan.departureAt) lines.push(`Odjezd: ${plan.departureAt}`);
  lines.push(`Profil: ${plan.routePolicy.profile} · ${plan.routePolicy.preference}`, "");
  for (const stop of plan.stops) {
    const [lng, lat] = stop.location.coordinates;
    lines.push(
      `${stop.order + 1}. ${stop.name}`,
      `   GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}${stop.dwellMinutes ? ` · pobyt ${stop.dwellMinutes} min` : ""}`
    );
    const segment = plan.segments[stop.order];
    if (!segment) continue;
    const selected = segment.alternatives.find(
      (alternative) => alternative.id === segment.selectedAlternativeId
    );
    lines.push(
      selected
        ? `   ↓ ${distance(selected.distanceM)} · ${duration(selected.durationS)} · ${segment.provider ?? selected.providerId}`
        : `   ↓ úsek ${segment.status === "failed" ? "se nepodařilo vypočítat" : "čeká na výpočet"}`
    );
  }
  lines.push("", "Vytvořeno v MapOS. Externí navigace může trasu přepočítat odlišně.");
  return lines.join("\n");
}
