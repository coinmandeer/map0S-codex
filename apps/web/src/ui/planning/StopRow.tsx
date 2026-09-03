import type { PlanDocumentV2 } from "@mapos/layer-sdk";
import { useState } from "react";
import { Button, Icon, IconButton, InlineNotice, Menu, TextField } from "../kit";
import { StopLocationInput, type StopLocationSelection } from "./StopLocationInput";
import type { StopManualState } from "./types";

type PlanStop = PlanDocumentV2["stops"][number];

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
  onNameChange,
  onSelect,
  onAiQuery,
  onPick,
  onLocate,
  onManual,
  onManualClose,
  onCoordinateChange,
  onDwellChange,
  onMove,
  onRemove
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
  onNameChange: (name: string) => void;
  onSelect: (selection: StopLocationSelection) => void;
  onAiQuery: (prompt: string) => void;
  onPick: () => void;
  onLocate: () => void;
  onManual: () => void;
  onManualClose: () => void;
  onCoordinateChange: (lng: number, lat: number) => void;
  onDwellChange: (minutes: number) => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
}) {
  const [dwellOpen, setDwellOpen] = useState(false);
  const number = index + 1;
  const last = index === total - 1;
  const [lng, lat] = stop.location.coordinates;

  return (
    <div className="planner-stop" data-last={last || undefined}>
      <span className="planner-stop-rail" aria-hidden>
        <span className="planner-stop-bullet">
          {last ? <Icon name="flag" size={16} /> : number}
        </span>
      </span>
      <div className="planner-stop-main">
        <div className="planner-stop-row">
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
                label: stop.dwellMinutes ? "Upravit pobyt" : "Nastavit pobyt",
                icon: "schedule",
                onSelect: () => setDwellOpen(true)
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
          {stop.dwellMinutes ? (
            <span className="planner-stop-chip" data-testid={`stop-dwell-${number}`}>
              Pobyt {stop.dwellMinutes} min
            </span>
          ) : null}
        </div>

        {dwellOpen && (
          <div className="planner-stop-manual" data-testid={`stop-dwell-editor-${number}`}>
            <TextField
              type="number"
              min={0}
              step={5}
              label={`Pobyt na zastávce ${number}`}
              hint="Minuty, které se přičtou k času příjezdu"
              value={stop.dwellMinutes ?? 0}
              disabled={disabled}
              onChange={(event) => onDwellChange(Math.max(0, Number(event.target.value)))}
            />
            <div className="planner-stop-manual-actions">
              <span />
              <Button variant="tonal" size="sm" onClick={() => setDwellOpen(false)}>
                Hotovo
              </Button>
            </div>
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
