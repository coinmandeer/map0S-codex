import type { GeoFeature, PlanDocumentV2, PlanTemporalContextV2 } from "@mapos/layer-sdk";
import type { DistanceUnits } from "../../settings/preferences";
import { Button, Chip, IconButton } from "../kit";
import { SegmentRow } from "./SegmentRow";
import { StopRow } from "./StopRow";
import type { StopLocationSelection } from "./StopLocationInput";
import type { AiStopResult, StopManualState } from "./types";

/** How many stops are in the DOM at once. A 105-stop plan is legitimate; 105 comboboxes are
 *  not, so the list pages through them. */
export const STOP_WINDOW_SIZE = 25;

export interface StopListHandlers {
  onNameChange: (stopId: string, name: string) => void;
  onSelect: (stopId: string, selection: StopLocationSelection) => void;
  onAiQuery: (stopId: string, prompt: string) => void;
  onPick: (stopId: string) => void;
  onLocate: (stopId: string) => void;
  onManual: (stopId: string) => void;
  onManualClose: () => void;
  onCoordinateChange: (stopId: string, lng: number, lat: number) => void;
  onDwellChange: (stopId: string, minutes: number) => void;
  onMove: (stopId: string, toIndex: number) => void;
  onRemove: (stopId: string) => void;
  onAdd: (feature?: GeoFeature) => void;
  onPickNew: () => void;
  onToggleMapSelection: (segmentId: string | null) => void;
  onSelectAlternative: (segmentId: string, alternativeId: string) => void;
}

/** Stops and the segments between them, in one list (§4.5). */
export function StopList({
  plan,
  provider,
  units,
  aiEnabled,
  aiBusyStopId,
  locatingStopId,
  manual,
  disabled,
  windowStart,
  onWindowStart,
  selectedRouteSegmentId,
  temporalSegments,
  suggestions,
  aiStopAnswer,
  onOpenAiCandidate,
  onDismissAiAnswer,
  handlers
}: {
  plan: PlanDocumentV2;
  provider: string;
  units: DistanceUnits;
  aiEnabled: boolean;
  aiBusyStopId: string | null;
  locatingStopId: string | null;
  manual: StopManualState | null;
  disabled: boolean;
  windowStart: number;
  onWindowStart: (next: number) => void;
  selectedRouteSegmentId: string | null;
  temporalSegments: Map<string, PlanTemporalContextV2["segments"][number]>;
  suggestions: Array<{ feature: GeoFeature; layerId: string }>;
  aiStopAnswer: { stopId: string; prompt: string; text: string; results: AiStopResult[] } | null;
  onOpenAiCandidate: (stopId: string, prompt: string, result: AiStopResult) => void;
  onDismissAiAnswer: () => void;
  handlers: StopListHandlers;
}) {
  const visible = plan.stops.slice(windowStart, windowStart + STOP_WINDOW_SIZE);
  const windowEnd = windowStart + visible.length;
  const lastWindowStart = Math.floor((plan.stops.length - 1) / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE;

  return (
    <section className="planner-stops">
      <header className="planner-stops-header">
        <span className="kit-eyebrow">Zastávky</span>
        <span className="planner-stops-count" data-testid="plan-stop-count">
          {plan.stops.length} / ∞
        </span>
      </header>

      <div className="planner-stop-list">
        {visible.map((stop, visibleIndex) => {
          const index = windowStart + visibleIndex;
          const segment = plan.segments[index];
          const nextStop = plan.stops[index + 1];
          return (
            <div className="planner-stop-group" key={stop.id}>
              <StopRow
                stop={stop}
                index={index}
                total={plan.stops.length}
                provider={provider}
                aiEnabled={aiEnabled}
                aiBusy={aiBusyStopId === stop.id}
                locating={locatingStopId === stop.id}
                disabled={disabled}
                manual={manual?.stopId === stop.id ? manual : null}
                onNameChange={(name) => handlers.onNameChange(stop.id, name)}
                onSelect={(selection) => handlers.onSelect(stop.id, selection)}
                onAiQuery={(prompt) => handlers.onAiQuery(stop.id, prompt)}
                onPick={() => handlers.onPick(stop.id)}
                onLocate={() => handlers.onLocate(stop.id)}
                onManual={() => handlers.onManual(stop.id)}
                onManualClose={handlers.onManualClose}
                onCoordinateChange={(lng, lat) => handlers.onCoordinateChange(stop.id, lng, lat)}
                onDwellChange={(minutes) => handlers.onDwellChange(stop.id, minutes)}
                onMove={(toIndex) => handlers.onMove(stop.id, toIndex)}
                onRemove={() => handlers.onRemove(stop.id)}
              />
              {segment && nextStop && visibleIndex < visible.length - 1 && (
                <SegmentRow
                  segment={segment}
                  from={stop.name}
                  to={nextStop.name}
                  units={units}
                  selectedOnMap={selectedRouteSegmentId === segment.id}
                  temporal={temporalSegments.get(segment.id)}
                  onToggleMapSelection={() =>
                    handlers.onToggleMapSelection(
                      selectedRouteSegmentId === segment.id ? null : segment.id
                    )
                  }
                  onSelectAlternative={(alternativeId) =>
                    handlers.onSelectAlternative(segment.id, alternativeId)
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {plan.stops.length > STOP_WINDOW_SIZE && (
        <nav className="planner-stop-window" aria-label="Stránkování zastávek">
          <IconButton
            icon="chevron_left"
            label="Předchozí zastávky"
            size="sm"
            disabled={windowStart === 0}
            onClick={() => onWindowStart(Math.max(0, windowStart - STOP_WINDOW_SIZE))}
          />
          <span>
            {windowStart + 1}–{windowEnd} z {plan.stops.length}
          </span>
          <IconButton
            icon="chevron_right"
            label="Další zastávky"
            size="sm"
            disabled={windowEnd >= plan.stops.length}
            onClick={() => onWindowStart(Math.min(windowStart + STOP_WINDOW_SIZE, lastWindowStart))}
          />
        </nav>
      )}

      <div className="planner-stop-add">
        <Button variant="text" icon="add" disabled={disabled} onClick={() => handlers.onAdd()}>
          Přidat zastávku
        </Button>
        <Button
          variant="text"
          icon="map"
          disabled={disabled}
          testId="pick-new-stop"
          onClick={handlers.onPickNew}
        >
          Vybrat z mapy
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="planner-suggestions" aria-label="Viditelná místa pro plán">
          {suggestions.map(({ feature, layerId }) => (
            <Chip
              key={`${layerId}:${String(feature.properties.id)}`}
              icon="add_location"
              label={String(feature.properties.name ?? "Místo na mapě")}
              disabled={disabled}
              onClick={() => handlers.onAdd(feature)}
            />
          ))}
        </div>
      )}

      {aiStopAnswer && (
        <div className="planner-ai-results" data-testid="planner-ai-results" role="status">
          <p className="planner-ai-results-text">{aiStopAnswer.text}</p>
          {aiStopAnswer.results.map((result) => (
            <Chip
              key={result.id}
              icon="auto_awesome"
              label={`${result.title} · ${Math.round(result.distanceMeters)} m`}
              onClick={() => onOpenAiCandidate(aiStopAnswer.stopId, aiStopAnswer.prompt, result)}
            />
          ))}
          <Button variant="text" size="sm" onClick={onDismissAiAnswer}>
            Zavřít návrhy
          </Button>
        </div>
      )}
    </section>
  );
}
