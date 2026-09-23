import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapPickerLocation } from "../../search/mapPicker";
import { emit, on } from "../../lib/events";
import { mapPickerControllers } from "../../store/mapPickerRuntime";
import { getMapStore } from "../../store/mapStore";
import { getShellStore } from "../../store/shellStore";
import type { MapPickerState } from "../../store/shellState";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

export function MapPickerHost() {
  const picker = useShellStoreSnapshot((state) => state.mapPicker);
  if (picker.type === "closed") return null;
  return <ActiveMapPickerHost key={picker.session.id} picker={picker} />;
}

function ActiveMapPickerHost({ picker }: { picker: Extract<MapPickerState, { type: "active" }> }) {
  const shell = getShellStore();
  const store = getMapStore();
  const view = useMapStoreSnapshot((state) => state.view);
  const [picked, setPicked] = useState<MapPickerLocation | null>(null);
  const settledRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /**
   * While a point is being picked the map is the whole interface.
   *
   * Legends, the mode bar, the loading pill and the rest are all things to read later; what
   * matters now is seeing the ground and one button that says "this place". The flag lives on
   * the document element because the chrome is rendered as siblings, with no shared wrapper.
   */
  useEffect(() => {
    document.documentElement.dataset.mapPicker = "active";
    return () => {
      delete document.documentElement.dataset.mapPicker;
    };
  }, []);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

  useEffect(() => {
    shell.updateMapPickerCandidate({ lng: view.lng, lat: view.lat });
  }, [shell, view.lat, view.lng, view.zoom]);

  // MapLibre settles independently of React. Listening to its typed camera signal keeps the
  // fixed pin exact even if several store renders are batched while a slow basemap is loading.
  useEffect(
    () =>
      on("map-view-changed", ({ lng, lat }) => {
        shell.updateMapPickerCandidate({ lng, lat });
      }),
    [shell]
  );

  const restoreInitialView = useCallback(() => {
    if (picker.session.cancelPolicy !== "restore-original-view") return;
    const original = {
      lng: picker.session.originalView.center.lng,
      lat: picker.session.originalView.center.lat,
      zoom: picker.session.originalView.zoom
    };
    store.setView(original);
    emit("fly-to", original);
  }, [
    picker.session.cancelPolicy,
    picker.session.originalView.center.lat,
    picker.session.originalView.center.lng,
    picker.session.originalView.zoom,
    store
  ]);

  const cancel = useCallback(() => {
    settledRef.current = true;
    restoreInitialView();
    mapPickerControllers.cancel(picker.session.id, "user");
    shell.closeMapPicker("user");
  }, [picker.session.id, restoreInitialView, shell]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  const candidate = picker.session.candidate ?? { lat: view.lat, lng: view.lng };
  const suggestions = picker.session.suggestions ?? [];

  /** A suggestion moves the pin; the camera signal that follows carries no label, so the chosen
   *  one is remembered here and re-attached on confirm while the pin is still on it (§4.5). */
  const pickSuggestion = (suggestion: MapPickerLocation) => {
    setPicked(suggestion);
    shell.updateMapPickerCandidate(suggestion);
    emit("fly-to", { lng: suggestion.lng, lat: suggestion.lat, zoom: Math.max(view.zoom, 14) });
  };

  const onPin = (location: MapPickerLocation) =>
    Math.abs(location.lat - candidate.lat) < 1e-5 && Math.abs(location.lng - candidate.lng) < 1e-5;

  const confirmAt = (location: MapPickerLocation) => {
    settledRef.current = true;
    mapPickerControllers.confirm(picker.session.id, location);
    shell.closeMapPicker("caller");
  };

  // A tap on the map answers the picker where the finger already is. The label is left to the
  // caller to fill in (reverse geocode), so the coordinate lands in the plan immediately.
  useEffect(
    () => on("map-picker-tap", ({ lng, lat }) => confirmAt({ lng, lat })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picker.session.id, shell]
  );

  const select = () => {
    settledRef.current = true;
    const label = picked && onPin(picked) ? picked.label : candidate.label;
    // The first React effect may not have copied the map centre into the serializable session yet.
    // Confirm the value displayed by this render so an immediate click can never strand the host.
    mapPickerControllers.confirm(picker.session.id, {
      lat: candidate.lat,
      lng: candidate.lng,
      ...(label ? { label } : {})
    });
    shell.closeMapPicker("caller");
  };

  return (
    <section
      className="shell-map-picker"
      aria-label={picker.session.caller.label}
      data-testid="map-picker-host"
    >
      <div className="shell-map-picker-header">
        <strong>{picker.session.caller.label}</strong>
        <button type="button" className="btn btn-ghost small" onClick={cancel}>
          Zrušit
        </button>
      </div>
      <div className="shell-map-picker-pin" aria-hidden="true">
        <span />
      </div>
      {suggestions.length > 0 && (
        <ul className="shell-map-picker-suggestions" data-testid="map-picker-suggestions">
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.lat}:${suggestion.lng}:${index}`}>
              <button
                type="button"
                className="btn btn-ghost small"
                aria-pressed={onPin(suggestion)}
                data-testid={`map-picker-suggestion-${index + 1}`}
                onClick={() => pickSuggestion(suggestion)}
              >
                {suggestion.label ?? `${suggestion.lat.toFixed(4)}, ${suggestion.lng.toFixed(4)}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="shell-map-picker-actions">
        <output aria-live="polite">
          {candidate.lat.toFixed(6)}, {candidate.lng.toFixed(6)}
        </output>
        <button type="button" className="btn" onClick={select} data-testid="map-picker-select">
          Vybrat místo
        </button>
      </div>
    </section>
  );
}
