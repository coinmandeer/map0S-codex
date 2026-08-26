import { useEffect, useRef } from "react";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useSimulationController } from "../layers/game/useSimulationController";
import { emit, on } from "../lib/events";
import { geolocation } from "../lib/geolocation";

/** Bridges keyboard/GPS simulation to the game layer when in game mode. */
export function GameSimulationBridge() {
  const mode = useMapStoreSnapshot((s) => s.mode);
  const view = useMapStoreSnapshot((s) => s.view);
  const cameraMode = useMapStoreSnapshot((s) => s.gameCameraMode);
  const trackingMode = useMapStoreSnapshot((s) => s.gameTrackingMode);

  const simulation = useSimulationController(
    { latitude: view.lat, longitude: view.lng },
    mode === "game"
  );
  const seededRef = useRef(false);

  useEffect(() => {
    simulation.setRelativeMovement(cameraMode === "follow");
  }, [cameraMode, simulation]);

  useEffect(() => {
    simulation.setTrackingMode(trackingMode);
  }, [trackingMode, simulation]);

  useEffect(() => {
    return on("map-bearing", ({ bearing }) => simulation.setMovementBearing(bearing));
  }, [simulation]);

  useEffect(() => {
    if (mode !== "game") {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    // The map centre is a fine place to start playing from, so a missing fix is not an error
    // here — the game just begins wherever the user was already looking.
    geolocation
      .getPosition({ timeoutMs: 6000, maxAgeMs: 15_000 })
      .then((fix) => {
        simulation.seedPosition({ latitude: fix.lat, longitude: fix.lng });
        emit("fly-to", { lng: fix.lng, lat: fix.lat, zoom: 16 });
      })
      .catch(() => {
        simulation.seedPosition({ latitude: view.lat, longitude: view.lng });
      });
  }, [mode, simulation, view.lat, view.lng]);

  return null;
}
