import { useEffect, useRef, useState } from "react";
import { emit, on } from "../lib/events";
import { GAME_AVATAR_V2_ENABLED } from "../lib/featureFlags";
import { joystickVector } from "../layers/game/touchControls";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";

type Direction = "up" | "down" | "left" | "right";

const DIRECTION_VECTOR: Record<Direction, { x: number; y: number; label: string; glyph: string }> =
  {
    up: { x: 0, y: 1, label: "Jít dopředu", glyph: "↑" },
    down: { x: 0, y: -1, label: "Jít dozadu", glyph: "↓" },
    left: { x: -1, y: 0, label: "Jít doleva", glyph: "←" },
    right: { x: 1, y: 0, label: "Jít doprava", glyph: "→" }
  };

function emitAccessibleDirection(direction: Direction, active: boolean) {
  const vector = DIRECTION_VECTOR[direction];
  emit("game-movement-vector", {
    source: "accessible",
    x: vector.x,
    y: vector.y,
    active
  });
}

function DirectionButton({ direction }: { direction: Direction }) {
  const pointerUsed = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vector = DIRECTION_VECTOR[direction];
  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      emitAccessibleDirection(direction, false);
    },
    [direction]
  );
  return (
    <button
      type="button"
      className={`game-dpad-${direction}`}
      aria-label={vector.label}
      onPointerDown={(event) => {
        pointerUsed.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        emitAccessibleDirection(direction, true);
      }}
      onPointerUp={() => emitAccessibleDirection(direction, false)}
      onPointerCancel={() => emitAccessibleDirection(direction, false)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") emitAccessibleDirection(direction, true);
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") emitAccessibleDirection(direction, false);
      }}
      onClick={() => {
        if (pointerUsed.current) {
          pointerUsed.current = false;
          return;
        }
        emitAccessibleDirection(direction, true);
        releaseTimer.current = setTimeout(() => emitAccessibleDirection(direction, false), 180);
      }}
    >
      {vector.glyph}
    </button>
  );
}

export function AccessibleGameDpad() {
  return (
    <div className="game-dpad" role="group" aria-label="Přístupné směrové ovládání">
      <DirectionButton direction="up" />
      <DirectionButton direction="left" />
      <button
        type="button"
        className="game-dpad-stop"
        aria-label="Zastavit pohyb"
        onClick={() => emit("game-movement-cancel")}
      >
        ■
      </button>
      <DirectionButton direction="right" />
      <DirectionButton direction="down" />
    </div>
  );
}

interface ControllerStatus {
  activeInput: "keyboard" | "touch" | "accessible" | "tap" | "gps" | null;
  moving: boolean;
  tapToMoveEnabled: boolean;
  hasTapTarget: boolean;
}

const INITIAL_STATUS: ControllerStatus = {
  activeInput: null,
  moving: false,
  tapToMoveEnabled: false,
  hasTapTarget: false
};

/** Minimal map overlay. The information hierarchy stays in GameHud/PanelShell. */
export function GameControls() {
  const mode = useMapStoreSnapshot((state) => state.mode);
  const trackingMode = useMapStoreSnapshot((state) => state.gameTrackingMode);
  const [status, setStatus] = useState<ControllerStatus>(INITIAL_STATUS);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const joystickRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  useEffect(
    () =>
      on("game-controller-status", (next) => {
        setStatus({
          activeInput: next.activeInput,
          moving: next.moving,
          tapToMoveEnabled: next.tapToMoveEnabled,
          hasTapTarget: next.hasTapTarget
        });
      }),
    []
  );

  useEffect(
    () => () => {
      emit("game-movement-vector", { source: "touch", x: 0, y: 0, active: false });
      emit("game-tap-mode", { enabled: false });
    },
    []
  );

  if (mode !== "game" || !GAME_AVATAR_V2_ENABLED) return null;
  const simulation = trackingMode === "simulation";

  const updatePointer = (clientX: number, clientY: number) => {
    const bounds = joystickRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const vector = joystickVector(
      { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
      { x: clientX, y: clientY },
      bounds.width * 0.36
    );
    setKnob({ x: vector.x * bounds.width * 0.28, y: -vector.y * bounds.height * 0.28 });
    emit("game-movement-vector", {
      source: "touch",
      x: vector.x,
      y: vector.y,
      active: Math.hypot(vector.x, vector.y) > 0.08
    });
  };

  const release = () => {
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    emit("game-movement-vector", { source: "touch", x: 0, y: 0, active: false });
  };

  return (
    <div className="game-mobile-controls" data-testid="game-mobile-controls">
      <div
        ref={joystickRef}
        className="game-joystick"
        data-disabled={!simulation || undefined}
        role="group"
        aria-label="Virtuální joystick pro pohyb hráče"
        onPointerDown={(event) => {
          if (!simulation) return;
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (activePointer.current === event.pointerId)
            updatePointer(event.clientX, event.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span
          className="game-joystick-knob"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      <div className="game-mobile-actions">
        <button
          type="button"
          className={status.tapToMoveEnabled ? "active" : ""}
          disabled={!simulation}
          aria-pressed={status.tapToMoveEnabled}
          onClick={() => emit("game-tap-mode", { enabled: !status.tapToMoveEnabled })}
        >
          Klepni a jdi
        </button>
        {(status.moving || status.hasTapTarget) && (
          <button type="button" onClick={() => emit("game-movement-cancel")}>
            Zastavit
          </button>
        )}
        <span role="status" aria-live="polite">
          {trackingMode === "gps"
            ? "GPS"
            : status.activeInput === "tap"
              ? "Jdu k bodu"
              : status.moving
                ? "Pohyb"
                : "Simulace"}
        </span>
      </div>
    </div>
  );
}
