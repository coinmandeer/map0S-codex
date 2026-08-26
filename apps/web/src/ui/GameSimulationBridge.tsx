import { useEffect, useRef } from "react";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useSimulationController } from "../layers/game/useSimulationController";

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
    const onCamera = (e: Event) => {
      const bearing = (e as CustomEvent<{ bearing: number }>).detail.bearing;
      simulation.setMovementBearing(bearing);
    };
    window.addEventListener("mapos:map-bearing", onCamera);
    return () => window.removeEventListener("mapos:map-bearing", onCamera);
  }, [simulation]);

  useEffect(() => {
    if (mode !== "game") {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    const fallback = () => {
      simulation.seedPosition({ latitude: view.lat, longitude: view.lng });
    };
    if (!navigator.geolocation) {
      fallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        simulation.seedPosition({ latitude: lat, longitude: lng });
        window.dispatchEvent(new CustomEvent("mapos:fly-to", { detail: { lng, lat, zoom: 16 } }));
      },
      fallback,
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 15_000 }
    );
  }, [mode, simulation, view.lat, view.lng]);

  return null;
}
