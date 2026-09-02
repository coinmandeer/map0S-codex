import { isValidCoordinates, type Coordinates } from "./coordinates.js";
import { containsControlCharacters } from "./textSafety.js";

export const MAP_PICKER_SESSION_VERSION = 1 as const;

export interface MapPickerView {
  center: Coordinates;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface MapPickerLocation extends Coordinates {
  label?: string;
}

export interface MapPickerCaller {
  id: string;
  label: string;
  context?: string;
}

export type MapPickerCancelPolicy = "restore-original-view" | "keep-current-view";

export interface MapPickerSession {
  version: typeof MAP_PICKER_SESSION_VERSION;
  id: string;
  caller: MapPickerCaller;
  cancelPolicy: MapPickerCancelPolicy;
  originalView: MapPickerView;
  candidate?: MapPickerLocation;
  createdAt: number;
  updatedAt: number;
}

export type MapPickerCancelReason = "user" | "superseded" | "disposed" | "caller";

export type MapPickerResult =
  | { status: "confirmed"; sessionId: string; location: MapPickerLocation }
  | {
      status: "cancelled";
      sessionId: string;
      reason: MapPickerCancelReason;
      restoreView?: MapPickerView;
    };

export interface OpenMapPickerInput {
  id?: string;
  caller: MapPickerCaller;
  cancelPolicy?: MapPickerCancelPolicy;
  originalView: MapPickerView;
  candidate?: MapPickerLocation;
}

export interface MapPickerRegistryOptions {
  now?: () => number;
  createId?: () => string;
  onCallbackError?: (error: unknown, result: MapPickerResult) => void;
}

type SettlementCallback = (result: MapPickerResult) => void;

let fallbackId = 0;

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `picker-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || containsControlCharacters(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maximum ? normalized : null;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function coordinates(value: unknown): Coordinates | null {
  if (!plainRecord(value)) return null;
  if (typeof value.lat !== "number" || typeof value.lng !== "number") return null;
  const candidate: Coordinates = { lat: value.lat, lng: value.lng };
  return isValidCoordinates(candidate) ? candidate : null;
}

function mapLocation(value: unknown): MapPickerLocation | null {
  if (!plainRecord(value)) return null;
  const position = coordinates(value);
  if (!position) return null;
  if (value.label !== undefined) {
    const label = text(value.label, 240);
    if (!label) return null;
    return { ...position, label };
  }
  return position;
}

function mapView(value: unknown): MapPickerView | null {
  if (!plainRecord(value)) return null;
  const center = coordinates(value.center);
  if (!center || !finite(value.zoom, 0, 24)) return null;
  if (value.bearing !== undefined && !finite(value.bearing, -360, 360)) return null;
  if (value.pitch !== undefined && !finite(value.pitch, 0, 85)) return null;
  return {
    center,
    zoom: value.zoom,
    ...(typeof value.bearing === "number" ? { bearing: value.bearing } : {}),
    ...(typeof value.pitch === "number" ? { pitch: value.pitch } : {})
  };
}

function caller(value: unknown): MapPickerCaller | null {
  if (!plainRecord(value)) return null;
  const id = text(value.id, 120);
  const label = text(value.label, 160);
  if (!id || !label) return null;
  if (value.context !== undefined) {
    const context = text(value.context, 160);
    return context ? { id, label, context } : null;
  }
  return { id, label };
}

function cloneView(view: MapPickerView): MapPickerView {
  return { ...view, center: { ...view.center } };
}

function cloneLocation(value: MapPickerLocation): MapPickerLocation {
  return { ...value };
}

function cloneSession(session: MapPickerSession): MapPickerSession {
  return {
    ...session,
    caller: { ...session.caller },
    originalView: cloneView(session.originalView),
    ...(session.candidate ? { candidate: cloneLocation(session.candidate) } : {})
  };
}

/** Parses untrusted persisted state and returns a normalized data-only session. */
export function parseMapPickerSession(value: unknown): MapPickerSession | null {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > 10_000) return null;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!plainRecord(parsed) || parsed.version !== MAP_PICKER_SESSION_VERSION) return null;
  const id = text(parsed.id, 120);
  const parsedCaller = caller(parsed.caller);
  const originalView = mapView(parsed.originalView);
  const candidate = parsed.candidate === undefined ? undefined : mapLocation(parsed.candidate);
  const cancelPolicy = parsed.cancelPolicy;
  if (
    !id ||
    !parsedCaller ||
    !originalView ||
    (parsed.candidate !== undefined && !candidate) ||
    (cancelPolicy !== "restore-original-view" && cancelPolicy !== "keep-current-view") ||
    !Number.isSafeInteger(parsed.createdAt) ||
    !Number.isSafeInteger(parsed.updatedAt) ||
    (parsed.createdAt as number) < 0 ||
    (parsed.updatedAt as number) < (parsed.createdAt as number)
  ) {
    return null;
  }
  return {
    version: MAP_PICKER_SESSION_VERSION,
    id,
    caller: parsedCaller,
    cancelPolicy,
    originalView,
    ...(candidate ? { candidate } : {}),
    createdAt: parsed.createdAt as number,
    updatedAt: parsed.updatedAt as number
  };
}

export function serializeMapPickerSession(session: MapPickerSession): string {
  const normalized = parseMapPickerSession(session);
  if (!normalized) throw new TypeError("Invalid MapPicker session");
  return JSON.stringify(normalized);
}

/**
 * Keeps non-serializable callbacks outside the session. Every settlement removes its callback
 * before invoking user code, making confirm/cancel idempotent even if the callback throws.
 */
export class MapPickerControllerRegistry {
  private readonly sessions = new Map<string, MapPickerSession>();
  private readonly callbacks = new Map<string, SettlementCallback>();
  private activeId?: string;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly onCallbackError?: (error: unknown, result: MapPickerResult) => void;
  private disposed = false;

  constructor(options: MapPickerRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultId;
    this.onCallbackError = options.onCallbackError;
  }

  get activeSession(): MapPickerSession | null {
    const session = this.activeId ? this.sessions.get(this.activeId) : undefined;
    return session ? cloneSession(session) : null;
  }

  open(input: OpenMapPickerInput, callback: SettlementCallback): MapPickerSession {
    if (this.disposed) throw new Error("MapPicker registry is disposed");
    if (this.activeId) this.cancel(this.activeId, "superseded");
    const timestamp = this.timestamp();
    const candidate: MapPickerSession = {
      version: MAP_PICKER_SESSION_VERSION,
      id: input.id ?? this.createId(),
      caller: input.caller,
      cancelPolicy: input.cancelPolicy ?? "restore-original-view",
      originalView: input.originalView,
      ...(input.candidate ? { candidate: input.candidate } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.attach(candidate, callback);
  }

  attach(value: unknown, callback: SettlementCallback): MapPickerSession {
    if (this.disposed) throw new Error("MapPicker registry is disposed");
    const session = parseMapPickerSession(value);
    if (!session) throw new TypeError("Invalid MapPicker session");
    if (this.activeId && this.activeId !== session.id) this.cancel(this.activeId, "superseded");
    if (this.sessions.has(session.id)) this.cancel(session.id, "superseded");
    this.sessions.set(session.id, session);
    this.callbacks.set(session.id, callback);
    this.activeId = session.id;
    return cloneSession(session);
  }

  get(sessionId: string): MapPickerSession | null {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  updateCandidate(sessionId: string, value: MapPickerLocation): MapPickerSession | null {
    const session = this.sessions.get(sessionId);
    const normalized = mapLocation(value);
    if (!session || !normalized) return null;
    const updated: MapPickerSession = {
      ...session,
      candidate: normalized,
      updatedAt: Math.max(session.updatedAt, this.timestamp())
    };
    this.sessions.set(sessionId, updated);
    return cloneSession(updated);
  }

  confirm(sessionId: string, value?: MapPickerLocation): MapPickerResult | null {
    const session = this.sessions.get(sessionId);
    const selected = value === undefined ? session?.candidate : mapLocation(value);
    if (!session || !selected) return null;
    return this.settle(session, {
      status: "confirmed",
      sessionId,
      location: cloneLocation(selected)
    });
  }

  cancel(
    sessionId = this.activeId,
    reason: MapPickerCancelReason = "user"
  ): MapPickerResult | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.settle(session, {
      status: "cancelled",
      sessionId,
      reason,
      ...(session.cancelPolicy === "restore-original-view"
        ? { restoreView: cloneView(session.originalView) }
        : {})
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sessionId of [...this.sessions.keys()]) this.cancel(sessionId, "disposed");
  }

  private settle(session: MapPickerSession, result: MapPickerResult): MapPickerResult {
    const callback = this.callbacks.get(session.id);
    this.callbacks.delete(session.id);
    this.sessions.delete(session.id);
    if (this.activeId === session.id) this.activeId = undefined;
    if (callback) {
      try {
        callback(result);
      } catch (error) {
        this.onCallbackError?.(error, result);
      }
    }
    return result;
  }

  private timestamp(): number {
    const value = Math.floor(this.now());
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}
