import { useCallback, useEffect, useRef } from "react";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useSimulationController } from "../layers/game/useSimulationController";
import { on } from "../lib/events";
import { getMapStore } from "../store/mapStore";

/** Bridges keyboard/GPS simulation to the game layer when in game mode. */
export function GameSimulationBridge() {
  const mode = useMapStoreSnapshot((s) => s.mode);
  const view = useMapStoreSnapshot((s) => s.view);
  const cameraMode = useMapStoreSnapshot((s) => s.gameCameraMode);
  const trackingMode = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const fallbackToSimulation = useCallback(() => {
    const store = getMapStore();
    store.setGameTrackingMode("simulation");
    store.showToast("GPS není dostupná; pokračuji v označené simulaci.");
  }, []);

  const simulation = useSimulationController(
    { latitude: view.lat, longitude: view.lng },
    mode === "game",
    fallbackToSimulation
  );
  const { seedPosition, setMovementBearing, setRelativeMovement, setTrackingMode } = simulation;
  const seededRef = useRef(false);

  useEffect(() => {
    setRelativeMovement(cameraMode === "follow");
  }, [cameraMode, setRelativeMovement]);

  useEffect(() => {
    setTrackingMode(trackingMode);
  }, [trackingMode, setTrackingMode]);

  useEffect(() => {
    return on("map-bearing", ({ bearing }) => setMovementBearing(bearing));
  }, [setMovementBearing]);

  useEffect(() => {
    if (mode !== "game") {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    // Simulation starts immediately where the map already is. The old six-second best-effort GPS
    // lookup could resolve after the player had started walking and teleport them back here. GPS is
    // now requested only when the player explicitly selects it in the HUD.
    seedPosition({ latitude: view.lat, longitude: view.lng });
  }, [mode, seedPosition, view.lat, view.lng]);

  return null;
}
