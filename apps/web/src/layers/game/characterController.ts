import { offsetCoordinates, type Coordinates } from "./geo";

export type CharacterInputSource = "keyboard" | "touch" | "accessible" | "tap" | "gps";
export type CharacterAnchorMode = "locked-to-gps" | "free-roam" | "prototype-center";

export interface CharacterMovementVector {
  /** Screen-right, normalized to -1..1. */
  x: number;
  /** Screen/up, normalized to -1..1. */
  y: number;
}

export interface CharacterControllerSnapshot {
  physicalPosition: Coordinates | null;
  gamePosition: Coordinates;
  anchorMode: CharacterAnchorMode;
  activeInput: CharacterInputSource | null;
  moving: boolean;
  tapTarget: Coordinates | null;
  gpsAccuracyM: number | null;
}

const DEFAULT_SPEED_METERS_PER_SECOND = 42;
const MAX_STEP_MS = 100;
const TAP_ARRIVAL_METERS = 1.5;
const MIN_GPS_MOVEMENT_METERS = 1.5;
const MAX_GPS_JITTER_THRESHOLD_METERS = 8;
const DEG_TO_RAD = Math.PI / 180;

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalized(vector: CharacterMovementVector): CharacterMovementVector {
  const x = clamp(vector.x);
  const y = clamp(vector.y);
  const magnitude = Math.hypot(x, y);
  return magnitude > 1 ? { x: x / magnitude, y: y / magnitude } : { x, y };
}

export function deltaMeters(from: Coordinates, to: Coordinates): CharacterMovementVector {
  const meanLatitude = ((from.latitude + to.latitude) / 2) * DEG_TO_RAD;
  return {
    x: (to.longitude - from.longitude) * 111_320 * Math.max(0.01, Math.cos(meanLatitude)),
    y: (to.latitude - from.latitude) * 110_540
  };
}

export function shouldIgnoreGameKeyEvent(event: {
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (event.defaultPrevented) return true;
  const element = event.target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button" ||
    Boolean(element.isContentEditable)
  );
}

export class CharacterController {
  private physicalPosition: Coordinates | null = null;
  private gamePosition: Coordinates;
  private anchorMode: CharacterAnchorMode = "prototype-center";
  private vectors = new Map<
    Exclude<CharacterInputSource, "tap" | "gps">,
    CharacterMovementVector
  >();
  private tapTarget: Coordinates | null = null;
  private activeInput: CharacterInputSource | null = null;
  private moving = false;
  private gpsAccuracyM: number | null = null;

  constructor(
    initialPosition: Coordinates,
    private readonly speedMetersPerSecond = DEFAULT_SPEED_METERS_PER_SECOND
  ) {
    this.gamePosition = { ...initialPosition };
  }

  get snapshot(): CharacterControllerSnapshot {
    return {
      physicalPosition: this.physicalPosition ? { ...this.physicalPosition } : null,
      gamePosition: { ...this.gamePosition },
      anchorMode: this.anchorMode,
      activeInput: this.activeInput,
      moving: this.moving,
      tapTarget: this.tapTarget ? { ...this.tapTarget } : null,
      gpsAccuracyM: this.gpsAccuracyM
    };
  }

  setAnchorMode(mode: CharacterAnchorMode): void {
    this.anchorMode = mode;
    this.vectors.clear();
    this.tapTarget = null;
    this.moving = false;
    this.activeInput = mode === "locked-to-gps" ? "gps" : null;
    if (mode === "locked-to-gps" && this.physicalPosition) {
      this.gamePosition = { ...this.physicalPosition };
    }
  }

  seed(position: Coordinates, mode: CharacterAnchorMode = "prototype-center"): void {
    this.gamePosition = { ...position };
    this.setAnchorMode(mode);
  }

  applyGpsFix(position: Coordinates, accuracyM: number): void {
    const firstFix = this.physicalPosition === null;
    this.physicalPosition = { ...position };
    this.gpsAccuracyM = Number.isFinite(accuracyM) ? Math.max(0, accuracyM) : null;
    if (this.anchorMode === "locked-to-gps") {
      this.activeInput = "gps";
      const movement = deltaMeters(this.gamePosition, position);
      const distanceM = Math.hypot(movement.x, movement.y);
      const jitterThresholdM = Math.max(
        MIN_GPS_MOVEMENT_METERS,
        Math.min(MAX_GPS_JITTER_THRESHOLD_METERS, (this.gpsAccuracyM ?? 0) * 0.2)
      );
      // Keep the raw physical fix/accuracy for diagnostics, but do not visibly shake the avatar
      // for movement smaller than the reported receiver noise. Drift accumulates relative to the
      // last accepted game position, so a genuine slow walk is still accepted.
      if (firstFix || distanceM >= jitterThresholdM) {
        this.gamePosition = { ...position };
        this.moving = distanceM > 0;
      } else {
        this.moving = false;
      }
    }
  }

  setMovementVector(
    source: Exclude<CharacterInputSource, "tap" | "gps">,
    vector: CharacterMovementVector | null
  ): void {
    if (!vector || (Math.abs(vector.x) < 0.001 && Math.abs(vector.y) < 0.001)) {
      this.vectors.delete(source);
    } else {
      this.vectors.set(source, normalized(vector));
      this.tapTarget = null;
    }
  }

  setTapTarget(position: Coordinates | null): void {
    if (this.anchorMode === "locked-to-gps") return;
    this.tapTarget = position ? { ...position } : null;
    if (position) this.vectors.clear();
  }

  cancelMovement(): void {
    this.vectors.clear();
    this.tapTarget = null;
    this.activeInput = this.anchorMode === "locked-to-gps" ? "gps" : null;
    this.moving = false;
  }

  step(
    deltaMs: number,
    mapBearingDegrees: number,
    relativeToMap = true
  ): CharacterControllerSnapshot {
    if (this.anchorMode === "locked-to-gps") {
      this.activeInput = "gps";
      this.moving = false;
      return this.snapshot;
    }

    let vector = { x: 0, y: 0 };
    let source: CharacterInputSource | null = null;
    for (const [candidateSource, candidate] of this.vectors) {
      vector.x += candidate.x;
      vector.y += candidate.y;
      source = candidateSource;
    }
    vector = normalized(vector);

    if (!source && this.tapTarget) {
      const delta = deltaMeters(this.gamePosition, this.tapTarget);
      const distance = Math.hypot(delta.x, delta.y);
      if (distance <= TAP_ARRIVAL_METERS) {
        this.gamePosition = { ...this.tapTarget };
        this.tapTarget = null;
      } else {
        vector = { x: delta.x / distance, y: delta.y / distance };
        source = "tap";
      }
    }

    if (!source || (!vector.x && !vector.y)) {
      this.activeInput = null;
      this.moving = false;
      return this.snapshot;
    }

    let east = vector.x;
    let north = vector.y;
    if (relativeToMap && source !== "tap") {
      const bearing = mapBearingDegrees * DEG_TO_RAD;
      east = Math.sin(bearing) * vector.y + Math.cos(bearing) * vector.x;
      north = Math.cos(bearing) * vector.y - Math.sin(bearing) * vector.x;
    }
    const seconds = Math.max(0, Math.min(MAX_STEP_MS, deltaMs)) / 1000;
    const requestedDistance = this.speedMetersPerSecond * seconds;

    if (source === "tap" && this.tapTarget) {
      const remaining = deltaMeters(this.gamePosition, this.tapTarget);
      const distance = Math.hypot(remaining.x, remaining.y);
      if (requestedDistance >= distance) {
        this.gamePosition = { ...this.tapTarget };
        this.tapTarget = null;
      } else {
        this.gamePosition = offsetCoordinates(
          this.gamePosition,
          east * requestedDistance,
          north * requestedDistance
        );
      }
    } else {
      this.gamePosition = offsetCoordinates(
        this.gamePosition,
        east * requestedDistance,
        north * requestedDistance
      );
    }
    this.activeInput = source;
    this.moving = true;
    return this.snapshot;
  }
}
