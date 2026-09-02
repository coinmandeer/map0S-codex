import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
  const settledRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  const select = () => {
    settledRef.current = true;
    // The first React effect may not have copied the map centre into the serializable session yet.
    // Confirm the value displayed by this render so an immediate click can never strand the host.
    mapPickerControllers.confirm(picker.session.id, candidate);
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
