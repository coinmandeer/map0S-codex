import { useEffect, useRef, useState } from "react";
import type { Coordinates } from "./geo";
import { offsetCoordinates } from "./geo";
import { emit, on } from "../../lib/events";

const MOVEMENT_SPEED_METERS_PER_SECOND = 42;
const DEG_TO_RAD = Math.PI / 180;

interface MovementState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const emptyMovementState = (): MovementState => ({
  up: false,
  down: false,
  left: false,
  right: false
});

export type TrackingMode = "simulation" | "gps";

export function useSimulationController(initialPosition: Coordinates, enabled: boolean) {
  const [playerPosition, setPlayerPosition] = useState(initialPosition);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("simulation");
  const movementRef = useRef<MovementState>(emptyMovementState());
  const movementBearingRef = useRef(0);
  const relativeMovementRef = useRef(true);
  const geolocationWatchRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let frameId = 0;
    let previousTimestamp = performance.now();

    const tick = (timestamp: number) => {
      const ms = timestamp - previousTimestamp;
      previousTimestamp = timestamp;
      if (trackingMode === "simulation") {
        const movement = movementRef.current;
        const strafe = Number(movement.right) - Number(movement.left);
        const forward = Number(movement.up) - Number(movement.down);
        if (strafe || forward) {
          const magnitude = Math.hypot(strafe, forward) || 1;
          let east = (strafe / magnitude) * MOVEMENT_SPEED_METERS_PER_SECOND;
          let north = (forward / magnitude) * MOVEMENT_SPEED_METERS_PER_SECOND;
          if (relativeMovementRef.current) {
            const bearingRad = movementBearingRef.current * DEG_TO_RAD;
            const fEast =
              Math.sin(bearingRad) * (forward / magnitude) +
              Math.cos(bearingRad) * (strafe / magnitude);
            const fNorth =
              Math.cos(bearingRad) * (forward / magnitude) -
              Math.sin(bearingRad) * (strafe / magnitude);
            east = fEast * MOVEMENT_SPEED_METERS_PER_SECOND;
            north = fNorth * MOVEMENT_SPEED_METERS_PER_SECOND;
          }
          setPlayerPosition((current) =>
            offsetCoordinates(current, east * (ms / 1000), north * (ms / 1000))
          );
        }
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [enabled, trackingMode]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") movementRef.current.up = true;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s")
        movementRef.current.down = true;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a")
        movementRef.current.left = true;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d")
        movementRef.current.right = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w")
        movementRef.current.up = false;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s")
        movementRef.current.down = false;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a")
        movementRef.current.left = false;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d")
        movementRef.current.right = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || trackingMode !== "gps") {
      if (geolocationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
        geolocationWatchRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) {
      setTrackingMode("simulation");
      return;
    }
    geolocationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setPlayerPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => setTrackingMode("simulation"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 }
    );
    return () => {
      if (geolocationWatchRef.current !== null)
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
      geolocationWatchRef.current = null;
    };
  }, [enabled, trackingMode]);

  useEffect(() => {
    return on("game-tracking-changed", ({ mode }) => setTrackingMode(mode));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    emit("geolocation", { lng: playerPosition.longitude, lat: playerPosition.latitude });
  }, [playerPosition, enabled]);

  return {
    playerPosition,
    trackingMode,
    setTrackingMode,
    seedPosition: (coords: Coordinates) => setPlayerPosition(coords),
    setMovementBearing: (bearing: number) => {
      movementBearingRef.current = bearing;
    },
    setRelativeMovement: (enabledRelative: boolean) => {
      relativeMovementRef.current = enabledRelative;
    }
  };
}
