import type { DiscoverViewport } from "./context";

export type StableViewportStatus = "idle" | "waiting" | "loading" | "ready" | "error";

export interface StableViewportState<T> {
  status: StableViewportStatus;
  key: string | null;
  data: T | null;
  error: string | null;
  updatedAt: number | null;
}

export interface StableViewportControllerOptions<T> {
  request: (viewport: DiscoverViewport, signal: AbortSignal) => Promise<T>;
  onState?: (state: StableViewportState<T>) => void;
  delayMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function zoomBand(zoom: number): string {
  if (zoom <= 4) return "country";
  if (zoom <= 7) return "admin1";
  if (zoom <= 10) return "admin2";
  if (zoom <= 13) return "locality";
  return "neighbourhood";
}

function layerKey(viewport: DiscoverViewport): string {
  return [...new Set(viewport.activeLayerIds ?? [])].sort().join(",");
}

/** A stable cache bucket; bbox remains a query extent, not a boundary. */
export function stableViewportKey(viewport: DiscoverViewport): string {
  const cell = Math.max(0.0005, (360 / (256 * 2 ** Math.max(0, viewport.zoom))) * 32);
  const bucket = (value: number) => Math.round(value / cell);
  return [
    zoomBand(viewport.zoom),
    bucket(viewport.lng),
    bucket(viewport.lat),
    viewport.useCase?.trim().toLowerCase() || "general",
    layerKey(viewport),
    viewport.allowModelFallback ? "model" : "structured"
  ].join("|");
}

/** Ignores roughly sub-24px camera jitter while accumulating larger moves from the last anchor. */
export function isMeaningfulViewportChange(
  previous: DiscoverViewport,
  next: DiscoverViewport
): boolean {
  if (zoomBand(previous.zoom) !== zoomBand(next.zoom)) return true;
  if ((previous.useCase ?? "") !== (next.useCase ?? "")) return true;
  if (layerKey(previous) !== layerKey(next)) return true;
  if (Boolean(previous.allowModelFallback) !== Boolean(next.allowModelFallback)) return true;
  const previousBox = previous.bbox;
  const nextBox = next.bbox;
  if (previousBox && nextBox) {
    const width = Math.max(0.000001, previousBox[2] - previousBox[0]);
    const height = Math.max(0.000001, previousBox[3] - previousBox[1]);
    const previousCenter = [
      (previousBox[0] + previousBox[2]) / 2,
      (previousBox[1] + previousBox[3]) / 2
    ];
    const nextCenter = [(nextBox[0] + nextBox[2]) / 2, (nextBox[1] + nextBox[3]) / 2];
    const nextWidth = nextBox[2] - nextBox[0];
    const nextHeight = nextBox[3] - nextBox[1];
    return (
      Math.abs(nextCenter[0]! - previousCenter[0]!) > width * 0.08 ||
      Math.abs(nextCenter[1]! - previousCenter[1]!) > height * 0.08 ||
      Math.abs(nextWidth - width) > width * 0.08 ||
      Math.abs(nextHeight - height) > height * 0.08
    );
  }
  const degreesPerPixel = 360 / (256 * 2 ** Math.max(0, next.zoom));
  const threshold = degreesPerPixel * 24;
  return (
    Math.abs(next.lng - previous.lng) > threshold ||
    Math.abs(next.lat - previous.lat) > threshold ||
    Math.abs(next.zoom - previous.zoom) >= 0.5
  );
}

function copyState<T>(state: StableViewportState<T>): StableViewportState<T> {
  return { ...state };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class StableViewportController<T> {
  private readonly request: StableViewportControllerOptions<T>["request"];
  private readonly onState?: StableViewportControllerOptions<T>["onState"];
  private readonly delayMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<StableViewportControllerOptions<T>["setTimer"]>;
  private readonly clearTimer: NonNullable<StableViewportControllerOptions<T>["clearTimer"]>;
  private readonly cache = new Map<string, { value: T; expiresAt: number }>();
  private state: StableViewportState<T> = {
    status: "idle",
    key: null,
    data: null,
    error: null,
    updatedAt: null
  };
  private anchor: DiscoverViewport | null = null;
  private timer: unknown = null;
  private active: {
    key: string;
    controller: AbortController;
    promise: Promise<T | undefined>;
  } | null = null;
  private revision = 0;
  private disposed = false;

  constructor(options: StableViewportControllerOptions<T>) {
    this.request = options.request;
    this.onState = options.onState;
    this.delayMs = options.delayMs ?? 2_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  snapshot(): StableViewportState<T> {
    return copyState(this.state);
  }

  observe(viewport: DiscoverViewport): void {
    if (this.disposed) return;
    if (this.anchor && !isMeaningfulViewportChange(this.anchor, viewport)) return;
    this.anchor = { ...viewport, activeLayerIds: [...(viewport.activeLayerIds ?? [])] };
    const key = stableViewportKey(viewport);
    this.cancelTimer();
    // The cache bucket deliberately represents a region + zoom band. If an equivalent request
    // is already running, keep it instead of starting a second fetch for a nearby centre.
    if (this.active?.key === key) return;
    if (this.active) this.active.controller.abort();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.setState({
        status: "ready",
        key,
        data: cached.value,
        error: null,
        updatedAt: this.now()
      });
      return;
    }
    this.setState({ ...this.state, status: "waiting", key, error: null });
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.startRequest(viewport, key);
    }, this.delayMs);
  }

  refresh(viewport: DiscoverViewport): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    this.anchor = { ...viewport, activeLayerIds: [...(viewport.activeLayerIds ?? [])] };
    this.cancelTimer();
    const key = stableViewportKey(viewport);
    if (this.active?.key === key) return this.active.promise;
    this.active?.controller.abort();
    return this.startRequest(viewport, key);
  }

  pause(): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.revision += 1;
    this.active?.controller.abort();
    this.active = null;
    this.setState({ ...this.state, status: "idle", error: null });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.revision += 1;
    this.active?.controller.abort();
    this.active = null;
  }

  private startRequest(viewport: DiscoverViewport, key: string): Promise<T | undefined> {
    const controller = new AbortController();
    const revision = ++this.revision;
    this.setState({ ...this.state, status: "loading", key, error: null });
    const promise = this.request(viewport, controller.signal)
      .then((value) => {
        if (this.disposed || revision !== this.revision || controller.signal.aborted)
          return undefined;
        const updatedAt = this.now();
        this.cache.set(key, { value, expiresAt: updatedAt + this.cacheTtlMs });
        this.setState({ status: "ready", key, data: value, error: null, updatedAt });
        return value;
      })
      .catch((error: unknown) => {
        if (this.disposed || revision !== this.revision || controller.signal.aborted)
          return undefined;
        if (isAbortError(error)) {
          this.setState({ ...this.state, status: "idle", error: null });
          return undefined;
        }
        this.setState({
          ...this.state,
          status: "error",
          key,
          error: error instanceof Error ? error.message : "Kontext se nepodařilo načíst"
        });
        return undefined;
      })
      .finally(() => {
        if (this.active?.controller === controller) this.active = null;
      });
    this.active = { key, controller, promise };
    return promise;
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private setState(state: StableViewportState<T>): void {
    this.state = state;
    this.onState?.(copyState(state));
  }
}
