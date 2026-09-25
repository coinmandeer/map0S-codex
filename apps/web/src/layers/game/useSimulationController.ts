import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinates } from "./geo";
import {
  CharacterController,
  shouldIgnoreGameKeyEvent,
  type CharacterControllerSnapshot
} from "./characterController";
import { emit, on } from "../../lib/events";

const MOVEMENT_FRAME_MS = 1000 / 30;

export type TrackingMode = "simulation" | "gps";

function keyboardVector(keys: ReadonlySet<string>): { x: number; y: number } | null {
  const x =
    Number(keys.has("arrowright") || keys.has("d")) -
    Number(keys.has("arrowleft") || keys.has("a"));
  const y =
    Number(keys.has("arrowup") || keys.has("w")) - Number(keys.has("arrowdown") || keys.has("s"));
  return x || y ? { x, y } : null;
}

function movementKey(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  return ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)
    ? key
    : null;
}

export function useSimulationController(initialPosition: Coordinates, enabled: boolean) {
  const controllerRef = useRef<CharacterController | null>(null);
  if (!controllerRef.current) controllerRef.current = new CharacterController(initialPosition);
  const controller = controllerRef.current;
  const [playerPosition, setPlayerPosition] = useState(initialPosition);
  const [trackingMode, setTrackingModeState] = useState<TrackingMode>("simulation");
  const [tapToMoveEnabled, setTapToMoveEnabled] = useState(false);
  const movementBearingRef = useRef(0);
  const relativeMovementRef = useRef(true);
  const tapToMoveEnabledRef = useRef(false);

  const publishStatus = useCallback(
    (snapshot: CharacterControllerSnapshot = controller.snapshot) => {
      emit("game-controller-status", {
        anchorMode: snapshot.anchorMode,
        activeInput: snapshot.activeInput,
        moving: snapshot.moving,
        tapToMoveEnabled: tapToMoveEnabledRef.current,
        hasTapTarget: Boolean(snapshot.tapTarget),
        gpsAccuracyM: snapshot.gpsAccuracyM
      });
    },
    [controller]
  );

  useEffect(() => {
    if (!enabled || trackingMode !== "simulation") {
      controller.cancelMovement();
      publishStatus();
      return;
    }
    controller.setAnchorMode(
      controller.snapshot.anchorMode === "prototype-center" ? "prototype-center" : "free-roam"
    );
    const keys = new Set<string>();
    let frameId = 0;
    let previousTimestamp = 0;
    let lastHudAt = 0;

    const tick = (timestamp: number) => {
      frameId = 0;
      if (previousTimestamp === 0) previousTimestamp = timestamp;
      const elapsed = timestamp - previousTimestamp;
      if (elapsed < MOVEMENT_FRAME_MS) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }
      previousTimestamp = timestamp;
      if (document.hidden || document.querySelector('[aria-modal="true"],dialog[open]')) {
        keys.clear();
        controller.cancelMovement();
      }
      const snapshot = controller.step(
        elapsed,
        movementBearingRef.current,
        relativeMovementRef.current
      );
      // Renderer/camera receive position directly; React HUD is limited to five updates/s.
      emit("geolocation", {
        lng: snapshot.gamePosition.longitude,
        lat: snapshot.gamePosition.latitude
      });
      if (timestamp - lastHudAt >= 200 || !snapshot.moving) {
        lastHudAt = timestamp;
        setPlayerPosition(snapshot.gamePosition);
        publishStatus(snapshot);
      }
      if (snapshot.moving || snapshot.tapTarget) frameId = window.requestAnimationFrame(tick);
    };

    const ensureTicking = () => {
      if (frameId) return;
      previousTimestamp = performance.now();
      frameId = window.requestAnimationFrame(tick);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift" && !shouldIgnoreGameKeyEvent(event)) controller.setSprinting(true);
      const key = movementKey(event);
      if (
        !key ||
        shouldIgnoreGameKeyEvent(event) ||
        document.querySelector('[aria-modal="true"],dialog[open]')
      )
        return;
      event.preventDefault();
      keys.add(key);
      controller.setMovementVector("keyboard", keyboardVector(keys));
      ensureTicking();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") controller.setSprinting(false);
      const key = movementKey(event);
      if (!key) return;
      keys.delete(key);
      controller.setMovementVector("keyboard", keyboardVector(keys));
      publishStatus();
    };

    const offVector = on("game-movement-vector", ({ source, x, y, active }) => {
      controller.setMovementVector(source, active ? { x, y } : null);
      if (active) ensureTicking();
      else publishStatus();
    });
    const offTapMode = on("game-tap-mode", ({ enabled: nextEnabled }) => {
      tapToMoveEnabledRef.current = nextEnabled;
      setTapToMoveEnabled(nextEnabled);
      if (!nextEnabled) controller.setTapTarget(null);
      publishStatus();
    });
    const offTapTarget = on("game-tap-target", ({ lng, lat }) => {
      if (!tapToMoveEnabledRef.current) return;
      controller.setTapTarget({ longitude: lng, latitude: lat });
      publishStatus();
      ensureTicking();
    });
    const cancel = () => {
      keys.clear();
      controller.cancelMovement();
      publishStatus();
    };
    const onFocus = (event: FocusEvent) => {
      if (shouldIgnoreGameKeyEvent(event)) cancel();
    };
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    const offCancel = on("game-movement-cancel", cancel);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keyup", onKeyUp);
    publishStatus();
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      controller.cancelMovement();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keyup", onKeyUp);
      offVector();
      offTapMode();
      offTapTarget();
      offCancel();
    };
  }, [controller, enabled, publishStatus, trackingMode]);

  useEffect(() => {
    return on("game-tracking-changed", ({ mode }) => setTrackingModeState(mode));
  }, []);

  const seedPosition = useCallback(
    (coords: Coordinates) => {
      controller.seed(coords, "prototype-center");
      setPlayerPosition(coords);
      if (enabled) emit("geolocation", { lng: coords.longitude, lat: coords.latitude });
      publishStatus();
    },
    [controller, publishStatus, enabled]
  );
  const setMovementBearing = useCallback((bearing: number) => {
    movementBearingRef.current = bearing;
  }, []);
  const setRelativeMovement = useCallback((enabledRelative: boolean) => {
    relativeMovementRef.current = enabledRelative;
  }, []);
  const setTrackingMode = useCallback((mode: TrackingMode) => {
    setTrackingModeState(mode);
  }, []);

  return {
    playerPosition,
    trackingMode,
    tapToMoveEnabled,
    setTrackingMode,
    seedPosition,
    setMovementBearing,
    setRelativeMovement
  };
}
