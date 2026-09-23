import type { PlanDocumentV2 } from "@mapos/layer-sdk";
import { useState } from "react";
import { Button, Icon, IconButton, InlineNotice, Menu, TextField } from "../kit";
import { StopLocationInput, type StopLocationSelection } from "./StopLocationInput";
import type { StopManualState } from "./types";

type PlanStop = PlanDocumentV2["stops"][number];

/** What the map knows about the place a stop was taken from. */
export interface StopPlacePreview {
  name: string;
  photoUrl?: string;
}

/** One stop is one row (§4.5): the number, the multifunctional input and two icon buttons.
 *
 *  Everything else — my location, manual GPS, dwell, ordering, removal — is in the row's
 *  overflow menu, so a plan with twenty stops stays a list rather than a wall of controls. */
export function StopRow({
  stop,
  index,
  total,
  provider,
  aiEnabled,
  aiBusy,
  locating,
  disabled,
  manual,
  place,
  onNameChange,
  onSelect,
  onAiQuery,
  onPick,
  onLocate,
  onManual,
  onManualClose,
  onCoordinateChange,
  onMove,
  onRemove,
  onDwellChange,
  dragHandleProps
}: {
  stop: PlanStop;
  /** Zero-based position in the whole plan, not in the visible window. */
  index: number;
  total: number;
  provider: string;
  aiEnabled: boolean;
  aiBusy: boolean;
  locating: boolean;
  disabled: boolean;
  manual: StopManualState | null;
  /** The place this stop was taken from, when the map still has it — a picture and a name say
   *  more than an editable copy of the name does. */
  place: StopPlacePreview | null;
  onNameChange: (name: string) => void;
  onSelect: (selection: StopLocationSelection) => void;
  onAiQuery: (prompt: string) => void;
  onPick: () => void;
  onLocate: () => void;
  onManual: () => void;
  onManualClose: () => void;
  onCoordinateChange: (lng: number, lat: number) => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
  onDwellChange: (minutes: number) => void;
  /** dnd-kit listeners/attributes for the drag handle. Absent when dragging is unavailable. */
  dragHandleProps?: Record<string, unknown>;
}) {
  const number = index + 1;
  const last = index === total - 1;
  const [lng, lat] = stop.location.coordinates;
  const [editingName, setEditingName] = useState(false);
  const [editingDwell, setEditingDwell] = useState(false);
  // A stop that came from a pin is already a known place: showing its photo and name beats
  // showing an editable copy of its name, which is what the row used to be. Renaming stays one
  // click away rather than being the default state.
  const showPlaceCard = Boolean(place && !editingName && !manual);

  return (
    <div className="planner-stop" data-last={last || undefined}>
      <span className="planner-stop-rail">
        <button
          type="button"
          className="planner-stop-drag"
          aria-label={`Přesunout zastávku ${number}`}
          data-testid={`stop-drag-${number}`}
          {...(disabled ? {} : dragHandleProps)}
        >
          <span className="planner-stop-bullet">
            {last ? <Icon name="flag" size={16} /> : number}
          </span>
        </button>
      </span>
      <div className="planner-stop-main">
        <div className="planner-stop-row">
          {showPlaceCard && place ? (
            <div className="planner-stop-place" data-testid={`stop-place-${number}`}>
              {place.photoUrl ? (
                <img src={place.photoUrl} alt="" loading="lazy" />
              ) : (
                <span className="planner-stop-place-icon" aria-hidden>
                  <Icon name="place" size={18} />
                </span>
              )}
              <span className="planner-stop-place-name">{place.name}</span>
              <IconButton
                icon="edit"
                label={`Přepsat název zastávky ${number}`}
                size="sm"
                variant="plain"
                disabled={disabled}
                testId={`stop-place-edit-${number}`}
                onClick={() => setEditingName(true)}
              />
            </div>
          ) : (
            <StopLocationInput
              index={number}
              name={stop.name}
              provider={provider}
              aiEnabled={aiEnabled}
              aiBusy={aiBusy}
              onNameChange={onNameChange}
              onSelect={onSelect}
              onAiQuery={onAiQuery}
            />
          )}
          <IconButton
            icon="pin_drop"
            label={`Vybrat zastávku ${number} na mapě`}
            size="sm"
            disabled={disabled}
            testId={`pick-stop-${number}`}
            onClick={onPick}
          />
          <Menu
            testId={`stop-menu-${number}`}
            trigger={
              <IconButton
                icon="more_horiz"
                label={`Další akce zastávky ${number}`}
                size="sm"
                disabled={disabled}
              />
            }
            actions={[
              {
                id: "locate",
                label: locating ? "Zaměřuji…" : "Moje poloha",
                icon: "my_location",
                disabled: locating,
                onSelect: onLocate
              },
              {
                id: "manual",
                label: "Zadat GPS ručně",
                icon: "straighten",
                onSelect: onManual
              },
              {
                id: "dwell",
                label: "Doba zastávky…",
                icon: "schedule",
                onSelect: () => setEditingDwell((value) => !value)
              },
              {
                id: "up",
                label: "Posunout nahoru",
                icon: "arrow_upward",
                disabled: index === 0,
                onSelect: () => onMove(index - 1)
              },
              {
                id: "down",
                label: "Posunout dolů",
                icon: "arrow_downward",
                disabled: last,
                onSelect: () => onMove(index + 1)
              },
              {
                id: "remove",
                label: "Odebrat",
                icon: "delete",
                destructive: true,
                disabled: total <= 2,
                onSelect: onRemove
              }
            ]}
          />
        </div>
        <div className="planner-stop-meta">
          <span aria-label={`Souřadnice zastávky ${number}`}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
          {stop.dwellMinutes > 0 && <span>· {stop.dwellMinutes} min</span>}
        </div>

        {editingDwell && (
          <div className="planner-stop-dwell" data-testid={`stop-dwell-${number}`}>
            <TextField
              type="number"
              step={5}
              label={`Doba zastávky ${number} (minuty)`}
              value={stop.dwellMinutes}
              disabled={disabled}
              onChange={(event) =>
                onDwellChange(Math.max(0, Math.round(Number(event.target.value) || 0)))
              }
            />
            <Button variant="text" size="sm" onClick={() => setEditingDwell(false)}>
              Hotovo
            </Button>
          </div>
        )}

        {manual && (
          <div className="planner-stop-manual" data-testid={`location-fallback-${number}`}>
            {manual.reason !== "manual" && (
              <InlineNotice tone="warning">
                {manual.reason === "denied" ? "Poloha není povolená. " : "GPS teď není dostupná. "}
                {manual.message}
              </InlineNotice>
            )}
            <div className="planner-options-grid">
              <TextField
                type="number"
                step={0.0001}
                label={`Ruční délka ${number}`}
                value={Number(lng.toFixed(6))}
                disabled={disabled}
                onChange={(event) => onCoordinateChange(Number(event.target.value), lat)}
              />
              <TextField
                type="number"
                step={0.0001}
                label={`Ruční šířka ${number}`}
                value={Number(lat.toFixed(6))}
                disabled={disabled}
                onChange={(event) => onCoordinateChange(lng, Number(event.target.value))}
              />
            </div>
            <div className="planner-stop-manual-actions">
              <Button variant="text" size="sm" icon="pin_drop" onClick={onPick}>
                Vybrat bod na mapě
              </Button>
              <Button variant="tonal" size="sm" onClick={onManualClose}>
                Použít souřadnice
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
