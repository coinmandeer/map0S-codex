/** The application's single owner of device position.
 *
 *  Six places used to call `navigator.geolocation` independently, and none of them knew about
 *  the others. That produced two visible bugs:
 *
 *  1. The "my location" button called `getCurrentPosition(success, error)` with no options.
 *     The spec's default `timeout` is `Infinity`, so a fix that never arrives calls *neither*
 *     callback — the button did nothing at all, with no error to explain why. Every request
 *     here carries an explicit timeout, so a caller always gets an answer.
 *  2. One click in Objevuj fired two competing requests, because the button and the
 *     reverse-geocode lookup each asked separately.
 *
 *  So position is requested once and shared. The watch is reference-counted and only starts
 *  when something actually needs continuous updates, which keeps the permission prompt tied to
 *  a user action rather than to page load. */

export type GeolocationErrorKind =
  "unsupported" | "insecure-context" | "denied" | "unavailable" | "timeout";

export class GeolocationError extends Error {
  constructor(
    readonly kind: GeolocationErrorKind,
    message: string
  ) {
    super(message);
    this.name = "GeolocationError";
  }
}

export interface Fix {
  lng: number;
  lat: number;
  /** Metres. */
  accuracy: number;
  /** Device observation timestamp, bounded by receipt time to reject stale cached fixes. */
  receivedAt: number;
}

export interface GetPositionOptions {
  /** Accept a cached fix this old before asking the device for a new one. */
  maxAgeMs?: number;
  timeoutMs?: number;
  highAccuracy?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_AGE_MS = 30_000;

/** Czech, because that is the UI language. Each message says what the user can do about it —
 *  a denied permission needs different action from a timeout, and the old code showed the same
 *  "Nepodařilo se získat polohu" for both. */
const MESSAGES: Record<GeolocationErrorKind, string> = {
  unsupported: "Tento prohlížeč neumí zjistit polohu.",
  "insecure-context":
    "Poloha funguje jen přes HTTPS. Otevři aplikaci na https:// nebo na localhost.",
  denied: "Přístup k poloze je zakázaný. Povol ho v nastavení prohlížeče u této stránky.",
  unavailable: "Polohu se nepodařilo určit. Zkontroluj, že máš zapnuté umísťování.",
  timeout: "Zaměřování trvalo příliš dlouho. Zkus to prosím znovu."
};

export function messageFor(error: unknown): string {
  if (error instanceof GeolocationError) return MESSAGES[error.kind];
  return MESSAGES.unavailable;
}

function toFix(position: GeolocationPosition): Fix {
  return {
    lng: position.coords.longitude,
    lat: position.coords.latitude,
    accuracy: position.coords.accuracy,
    receivedAt: Math.min(
      Date.now(),
      Number.isFinite(position.timestamp) ? position.timestamp : Date.now()
    )
  };
}

function toError(error: GeolocationPositionError): GeolocationError {
  if (error.code === error.PERMISSION_DENIED) return new GeolocationError("denied", error.message);
  if (error.code === error.TIMEOUT) return new GeolocationError("timeout", error.message);
  return new GeolocationError("unavailable", error.message);
}

/** Geolocation exists on insecure origins but every call fails — and with the old infinite
 *  timeout it failed *silently*. Testing on a phone over `http://192.168.x.x:5173` hits exactly
 *  this, so it is worth naming rather than reporting as a generic failure. */
function unavailableReason(): GeolocationError | null {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return new GeolocationError("unsupported", "navigator.geolocation is missing");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return new GeolocationError("insecure-context", "geolocation requires a secure context");
  }
  return null;
}

let lastFix: Fix | null = null;
let lastError: GeolocationError | null = null;
let watchId: number | null = null;
const listeners = new Set<(fix: Fix) => void>();
/** Hear about fixes other code asked for, without starting a watch (and a permission prompt). */
const passiveListeners = new Set<(fix: Fix) => void>();
const errorListeners = new Set<(error: GeolocationError) => void>();
/** In-flight one-shot request, shared so simultaneous callers don't each start their own. */
let pending: Promise<Fix> | null = null;

function publish(fix: Fix) {
  lastError = null;
  lastFix = fix;
  for (const listener of listeners) listener(fix);
  for (const listener of passiveListeners) listener(fix);
}
function publishError(error: GeolocationError) {
  lastError = error;
  for (const listener of errorListeners) listener(error);
}

function startWatch() {
  if (watchId !== null) return;
  const blocked = unavailableReason();
  if (blocked) {
    publishError(blocked);
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (position) => publish(toFix(position)),
    (error) => publishError(toError(error)),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
  );
}

function stopWatch() {
  if (watchId === null || listeners.size > 0) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export const geolocation = {
  /** The most recent fix from any source, however old. */
  lastFix(): Fix | null {
    return lastFix;
  },

  /** Whether a fix could be requested at all, without asking for one. */
  unavailableReason,

  /** Permission state without triggering a prompt, so UI can explain itself up front.
   *  Returns "unknown" where the Permissions API is missing (notably older Safari). */
  async permission(): Promise<PermissionState | "unknown"> {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state;
    } catch {
      return "unknown";
    }
  },

  /** Resolves with a fix or rejects with a `GeolocationError` — never hangs. */
  async getPosition(options: GetPositionOptions = {}): Promise<Fix> {
    const blocked = unavailableReason();
    if (blocked) throw blocked;

    // `maxAgeMs: 0` means "no cached fix is acceptable", so it has to skip the cache even when
    // the fix arrived in this same millisecond.
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (lastFix && maxAgeMs > 0 && Date.now() - lastFix.receivedAt <= maxAgeMs) return lastFix;
    if (pending) return pending;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    pending = new Promise<Fix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const fix = toFix(position);
          publish(fix);
          resolve(fix);
        },
        (error) => reject(toError(error)),
        {
          enableHighAccuracy: options.highAccuracy ?? true,
          timeout: timeoutMs,
          maximumAge: maxAgeMs
        }
      );
    }).finally(() => {
      pending = null;
    });

    return pending;
  },

  /** Two-phase locate. Calls `onCoarse` synchronously with a cached fix when one exists, so the
   *  map moves the instant the user clicks instead of sitting still until the device answers,
   *  then resolves with the fresh fix. Without this the button feels broken on a cold start,
   *  which is a good part of why it felt unreliable even when it worked. */
  async locate(onCoarse?: (fix: Fix) => void, options: GetPositionOptions = {}): Promise<Fix> {
    if (onCoarse && lastFix) onCoarse(lastFix);
    return this.getPosition(options);
  },

  /** Continuous updates. Returns an unsubscribe; the underlying watch stops with the last one. */
  watch(listener: (fix: Fix) => void, onError?: (error: GeolocationError) => void): () => void {
    listeners.add(listener);
    if (onError) errorListeners.add(onError);
    if (lastError && onError) onError(lastError);
    startWatch();
    if (lastFix) listener(lastFix);
    return () => {
      listeners.delete(listener);
      if (onError) errorListeners.delete(onError);
      stopWatch();
    };
  },

  /** Called with every fix, but never asks for one: for UI that should wake up only once the
   *  user has chosen to share their position. */
  onFix(listener: (fix: Fix) => void): () => void {
    passiveListeners.add(listener);
    return () => {
      passiveListeners.delete(listener);
    };
  },

  /** Test seam: drops cached state so specs don't leak fixes into each other. */
  reset(): void {
    lastFix = null;
    lastError = null;
    pending = null;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    listeners.clear();
    errorListeners.clear();
  }
};
