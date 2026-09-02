const PROVIDER_ID = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;
const OUTCOMES = new Set<BrowserProviderOutcome>(["success", "error", "aborted", "circuit-open"]);
const MAX_PROVIDERS = 64;
const MAX_DURATION_MS = 120_000;

export type BrowserProviderOutcome = "success" | "error" | "aborted" | "circuit-open";

export interface BrowserProviderHealthSample {
  providerId: string;
  outcome: BrowserProviderOutcome;
  durationMs: number;
}

export interface BrowserProviderHealthBucket {
  providerId: string;
  outcome: BrowserProviderOutcome;
  count: number;
  durationMsSum: number;
  durationMsMax: number;
  lastAt: string;
}

export interface BrowserProviderHealthOptions {
  now?: () => Date;
  maxProviders?: number;
}

export interface BrowserProviderBackoffOptions {
  now?: () => number;
  failureThreshold?: number;
  openMs?: number;
  maxProviders?: number;
}

export interface BrowserProviderCircuitSnapshot {
  providerId: string;
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  retryAt: string | null;
}

interface BrowserProviderCircuitState {
  consecutiveFailures: number;
  openUntil: number;
  halfOpenInFlight: boolean;
}

function assertProviderId(providerId: string): void {
  if (!PROVIDER_ID.test(providerId)) {
    throw new TypeError("Browser providerId must be a code-owned lowercase slug");
  }
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)));
}

/**
 * Bounded, in-memory health aggregates for network work performed by the browser itself.
 *
 * Provider IDs and outcomes are code-owned enums. URLs, source IDs, map coordinates, filters and
 * error text are deliberately not accepted, so this snapshot is safe to inspect locally without
 * creating another place where private request context can accumulate.
 */
export class BrowserProviderHealth {
  private readonly buckets = new Map<string, BrowserProviderHealthBucket>();
  private readonly providers = new Set<string>();
  private readonly now: () => Date;
  private readonly maxProviders: number;

  constructor(options: BrowserProviderHealthOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxProviders = Math.max(1, Math.min(MAX_PROVIDERS, options.maxProviders ?? MAX_PROVIDERS));
  }

  record(sample: BrowserProviderHealthSample): void {
    assertProviderId(sample.providerId);
    if (!OUTCOMES.has(sample.outcome)) {
      throw new TypeError("Browser provider outcome must be a code-owned value");
    }
    if (!this.providers.has(sample.providerId)) {
      if (this.providers.size >= this.maxProviders) return;
      this.providers.add(sample.providerId);
    }

    const durationMs = boundedDuration(sample.durationMs);
    const key = `${sample.providerId}:${sample.outcome}`;
    const current = this.buckets.get(key);
    const next: BrowserProviderHealthBucket = {
      providerId: sample.providerId,
      outcome: sample.outcome,
      count: Math.min(Number.MAX_SAFE_INTEGER, (current?.count ?? 0) + 1),
      durationMsSum: Math.min(Number.MAX_SAFE_INTEGER, (current?.durationMsSum ?? 0) + durationMs),
      durationMsMax: Math.max(current?.durationMsMax ?? 0, durationMs),
      lastAt: this.now().toISOString()
    };
    this.buckets.set(key, next);
  }

  snapshot(): BrowserProviderHealthBucket[] {
    return [...this.buckets.values()]
      .map((bucket) => ({ ...bucket }))
      .sort(
        (left, right) =>
          left.providerId.localeCompare(right.providerId) ||
          left.outcome.localeCompare(right.outcome)
      );
  }

  reset(): void {
    this.buckets.clear();
    this.providers.clear();
  }
}

/** Bounded local circuit used only for providers contacted directly by the browser. */
export class BrowserProviderBackoff {
  private readonly states = new Map<string, BrowserProviderCircuitState>();
  private readonly now: () => number;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly maxProviders: number;

  constructor(options: BrowserProviderBackoffOptions = {}) {
    this.now = options.now ?? Date.now;
    this.failureThreshold = Math.max(1, Math.min(10, options.failureThreshold ?? 3));
    this.openMs = Math.max(1_000, Math.min(10 * 60_000, options.openMs ?? 60_000));
    this.maxProviders = Math.max(1, Math.min(MAX_PROVIDERS, options.maxProviders ?? MAX_PROVIDERS));
  }

  tryAcquire(providerId: string): boolean {
    assertProviderId(providerId);
    let state = this.states.get(providerId);
    if (!state) {
      if (this.states.size >= this.maxProviders) return false;
      state = { consecutiveFailures: 0, openUntil: 0, halfOpenInFlight: false };
      this.states.set(providerId, state);
    }
    const now = this.now();
    if (state.openUntil > now) return false;
    if (state.consecutiveFailures < this.failureThreshold) return true;
    if (state.halfOpenInFlight) return false;
    state.halfOpenInFlight = true;
    return true;
  }

  success(providerId: string): void {
    const state = this.state(providerId);
    if (!state) return;
    state.consecutiveFailures = 0;
    state.openUntil = 0;
    state.halfOpenInFlight = false;
  }

  failure(providerId: string): void {
    const state = this.state(providerId);
    if (!state) return;
    state.consecutiveFailures = Math.min(Number.MAX_SAFE_INTEGER, state.consecutiveFailures + 1);
    if (state.halfOpenInFlight || state.consecutiveFailures >= this.failureThreshold) {
      state.openUntil = this.now() + this.openMs;
    }
    state.halfOpenInFlight = false;
  }

  aborted(providerId: string): void {
    const state = this.state(providerId);
    if (state) state.halfOpenInFlight = false;
  }

  snapshot(): BrowserProviderCircuitSnapshot[] {
    const now = this.now();
    return [...this.states.entries()]
      .map(([providerId, state]) => ({
        providerId,
        state:
          state.openUntil > now
            ? ("open" as const)
            : state.consecutiveFailures >= this.failureThreshold
              ? ("half-open" as const)
              : ("closed" as const),
        consecutiveFailures: state.consecutiveFailures,
        retryAt: state.openUntil > now ? new Date(state.openUntil).toISOString() : null
      }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  clear(): void {
    this.states.clear();
  }

  private state(providerId: string): BrowserProviderCircuitState | null {
    assertProviderId(providerId);
    const existing = this.states.get(providerId);
    if (existing) return existing;
    if (this.states.size >= this.maxProviders) return null;
    const created = { consecutiveFailures: 0, openUntil: 0, halfOpenInFlight: false };
    this.states.set(providerId, created);
    return created;
  }
}

export const browserProviderHealth = new BrowserProviderHealth();
export const browserProviderBackoff = new BrowserProviderBackoff();
