import { geolocation } from "../lib/geolocation";
import { useEffect, useRef } from "react";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useSimulationController } from "../layers/game/useSimulationController";
import { on, emit } from "../lib/events";

/** Bridges keyboard/GPS simulation to the game layer when in game mode. */
export function GameSimulationBridge() {
  const mode = useMapStoreSnapshot((s) => s.mode);
  const view = useMapStoreSnapshot((s) => s.view);
  const cameraMode = useMapStoreSnapshot((s) => s.gameCameraMode);
  const trackingMode = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const simulation = useSimulationController(
    { latitude: view.lat, longitude: view.lng },
    mode === "game" && trackingMode === "simulation"
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
    // Start immediately; the bounded GPS lookup below may relocate only before movement.
    seedPosition({ latitude: view.lat, longitude: view.lng });
  }, [mode, seedPosition, view.lat, view.lng]);

  useEffect(() => {
    if (mode !== "game" || trackingMode !== "gps") return;
    let cancelled = false;
    const stop = on("game-controller-status", (status) => {
      if (status.moving) cancelled = true;
    });
    void geolocation
      .getPosition({ timeoutMs: 5000, maxAgeMs: 30000 })
      .then((fix) => {
        if (cancelled) return;
        seedPosition({ latitude: fix.lat, longitude: fix.lng });
        emit("fly-to", { lng: fix.lng, lat: fix.lat, zoom: 18.3 });
      })
      .catch(() => {
        /* Keep the immediately usable map position when GPS is denied. */
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode, trackingMode, seedPosition]);
  return null;
}
