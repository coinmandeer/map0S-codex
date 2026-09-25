import type { ReactNode } from "react";
import type { GeoFeature, PlanDocumentV2, PlanTemporalContextV2 } from "@mapos/layer-sdk";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DistanceUnits } from "../../settings/preferences";
import { buildSegmentHandoffs } from "../../planning/externalHandoff";
import { Button, Chip, IconButton } from "../kit";
import { SegmentRow } from "./SegmentRow";
import { StopRow, type StopPlacePreview } from "./StopRow";
import type { StopLocationSelection } from "./StopLocationInput";
import type { AiStopResult, StopManualState } from "./types";

interface SortableHandleBag {
  setNodeRef: (node: HTMLElement | null) => void;
  style: React.CSSProperties;
  isDragging: boolean;
  handleProps: Record<string, unknown>;
}

/** Wraps one stop group as a sortable item. A render prop keeps the markup in this file rather
 *  than splitting StopRow into an inner/outer pair. */
function SortableStop({
  id,
  disabled,
  children
}: {
  id: string;
  disabled: boolean;
  children: (bag: SortableHandleBag) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled });
  return (
    <>
      {children({
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        isDragging,
        handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners }
      })}
    </>
  );
}

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
  onMove: (stopId: string, toIndex: number) => void;
  onRemove: (stopId: string) => void;
  onDwellChange: (stopId: string, minutes: number) => void;
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
  stopPlaces,
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
  /** Places behind stops that came from map pins, keyed by `sourceFeatureId`. */
  stopPlaces: Map<string, StopPlacePreview>;
  aiStopAnswer: { stopId: string; prompt: string; text: string; results: AiStopResult[] } | null;
  onOpenAiCandidate: (stopId: string, prompt: string, result: AiStopResult) => void;
  onDismissAiAnswer: () => void;
  handlers: StopListHandlers;
}) {
  const visible = plan.stops.slice(windowStart, windowStart + STOP_WINDOW_SIZE);
  const visibleIds = visible.map((stop) => stop.id);
  const windowEnd = windowStart + visible.length;
  const lastWindowStart = Math.floor((plan.stops.length - 1) / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // Reorder within the visible window; the command engine splices into the whole plan, so the
  // target index is the window offset plus the index the stop was dropped on.
  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const newIndex = visibleIds.indexOf(overId);
    if (newIndex < 0) return;
    handlers.onMove(activeId, windowStart + newIndex);
  };

  return (
    <section className="planner-stops">
      <header className="planner-stops-header">
        <span className="kit-eyebrow">Zastávky</span>
        <span className="planner-stops-count" data-testid="plan-stop-count">
          {plan.stops.length} / ∞
        </span>
      </header>

      <div className="planner-stop-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            {visible.map((stop, visibleIndex) => {
              const index = windowStart + visibleIndex;
              const segment = plan.segments[index];
              const nextStop = plan.stops[index + 1];
              const fromCoord = stop.location.coordinates;
              const toCoord = nextStop?.location.coordinates;
              const externalLinks =
                segment && toCoord
                  ? buildSegmentHandoffs(
                      { lng: fromCoord[0], lat: fromCoord[1] },
                      { lng: toCoord[0], lat: toCoord[1] },
                      plan.routePolicy.profile,
                      plan.routePolicy.preference
                    )
                  : undefined;
              return (
                <SortableStop key={stop.id} id={stop.id} disabled={disabled}>
                  {({ setNodeRef, style, isDragging, handleProps }) => (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className="planner-stop-group"
                      data-dragging={isDragging || undefined}
                    >
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
                        place={
                          (stop.sourceFeatureId ? stopPlaces.get(stop.sourceFeatureId) : null) ??
                          null
                        }
                        dragHandleProps={handleProps}
                        onNameChange={(name) => handlers.onNameChange(stop.id, name)}
                        onSelect={(selection) => handlers.onSelect(stop.id, selection)}
                        onAiQuery={(prompt) => handlers.onAiQuery(stop.id, prompt)}
                        onPick={() => handlers.onPick(stop.id)}
                        onLocate={() => handlers.onLocate(stop.id)}
                        onManual={() => handlers.onManual(stop.id)}
                        onManualClose={handlers.onManualClose}
                        onCoordinateChange={(lng, lat) =>
                          handlers.onCoordinateChange(stop.id, lng, lat)
                        }
                        onMove={(toIndex) => handlers.onMove(stop.id, toIndex)}
                        onRemove={() => handlers.onRemove(stop.id)}
                        onDwellChange={(minutes) => handlers.onDwellChange(stop.id, minutes)}
                      />
                      {segment && nextStop && (
                        <SegmentRow
                          segment={segment}
                          from={stop.name}
                          to={nextStop.name}
                          units={units}
                          selectedOnMap={selectedRouteSegmentId === segment.id}
                          temporal={temporalSegments.get(segment.id)}
                          externalLinks={externalLinks}
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
                  )}
                </SortableStop>
              );
            })}
          </SortableContext>
        </DndContext>
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
