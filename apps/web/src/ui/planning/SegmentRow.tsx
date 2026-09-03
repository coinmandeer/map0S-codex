import type { PlanDocumentV2, PlanTemporalContextV2 } from "@mapos/layer-sdk";
import { selectedPlanAlternative } from "../../planning/planPresentation";
import {
  formatDistance,
  formatDistanceDelta,
  formatDuration,
  formatDurationDelta,
  formatPlanTime
} from "../../planning/planFormat";
import type { DistanceUnits } from "../../settings/preferences";
import { Icon } from "../kit";

type PlanSegment = PlanDocumentV2["segments"][number];
type TemporalSegment = PlanTemporalContextV2["segments"][number];

/** The thin line between two stops: how far, how long, and which variant is drawn (§4.5).
 *
 *  It is a row rather than a card because the stop above and below it are rows too — a card
 *  here would read as a third kind of thing in the same list. */
export function SegmentRow({
  segment,
  from,
  to,
  units,
  selectedOnMap,
  temporal,
  onToggleMapSelection,
  onSelectAlternative
}: {
  segment: PlanSegment;
  from: string;
  to: string;
  units: DistanceUnits;
  selectedOnMap: boolean;
  temporal: TemporalSegment | undefined;
  onToggleMapSelection: () => void;
  onSelectAlternative: (alternativeId: string) => void;
}) {
  const alternative = selectedPlanAlternative(segment);
  const recommended = segment.alternatives[0] ?? null;
  const order = segment.order + 1;

  return (
    <div
      className="planner-segment"
      data-status={segment.status}
      data-selected={selectedOnMap || undefined}
      data-testid={`plan-segment-${order}`}
      data-route-segment-id={segment.id}
      aria-current={selectedOnMap ? "true" : undefined}
      aria-label={`Úsek ${order}: ${from} → ${to}`}
    >
      <span className="planner-segment-rail" aria-hidden />
      <div className="planner-segment-body">
        <div className="planner-segment-line">
          <span className="planner-segment-metrics">
            {alternative
              ? `${formatDistance(alternative.distanceM, units)} · ${formatDuration(alternative.durationS)}`
              : segment.status === "failed"
                ? "Výpočet selhal"
                : "Čeká na výpočet"}
          </span>
          {alternative && (
            <button
              type="button"
              className="planner-segment-focus"
              aria-pressed={selectedOnMap}
              onClick={onToggleMapSelection}
            >
              {selectedOnMap ? "Vybráno v mapě" : "Zvýraznit v mapě"}
            </button>
          )}
        </div>

        {segment.alternatives.length > 1 && recommended && (
          <div
            className="planner-segment-alternatives"
            role="radiogroup"
            aria-label={`Varianty úseku ${order}`}
          >
            {segment.alternatives.map((candidate, index) => {
              const selected = candidate.id === segment.selectedAlternativeId;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="planner-segment-alternative"
                  data-testid={`segment-${order}-alternative-${index + 1}`}
                  onClick={() => onSelectAlternative(candidate.id)}
                >
                  <span>{index === 0 ? "Doporučená" : `Varianta ${index + 1}`}</span>
                  <small>
                    {index === 0
                      ? `${formatDistance(candidate.distanceM, units)} · ${formatDuration(candidate.durationS)}`
                      : `${formatDistanceDelta(candidate.distanceM - recommended.distanceM, units)} · ${formatDurationDelta(candidate.durationS - recommended.durationS)}`}
                  </small>
                </button>
              );
            })}
          </div>
        )}

        {temporal && (
          <div className="planner-segment-temporal" data-testid={`segment-${order}-temporal`}>
            <span>
              <Icon name="schedule" size={16} />
              {formatPlanTime(temporal.departureAt)} → {formatPlanTime(temporal.arrivalAt)}
            </span>
            <span>
              <Icon name="cloud" size={16} />
              {temporal.weatherAtArrival
                ? `${temporal.weatherAtArrival.temperatureC?.toFixed(1) ?? "—"} °C · ${temporal.weatherAtArrival.precipitationMm?.toFixed(1) ?? "—"} mm`
                : "počasí bez dostupných dat"}
            </span>
            {temporal.warnings.map((warning) => (
              <span className="planner-segment-warning" key={warning}>
                <Icon name="warning" size={16} />
                {warning}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
