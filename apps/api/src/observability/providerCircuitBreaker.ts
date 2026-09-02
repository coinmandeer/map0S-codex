export type CircuitState = "closed" | "open" | "half-open";

interface CircuitEntry {
  consecutiveFailures: number;
  openUntil: number;
  halfOpenInFlight: boolean;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface CircuitSnapshot {
  provider: string;
  state: CircuitState;
  consecutiveFailures: number;
  retryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Provider IDs are operational dimensions, not display names. Rejecting an invalid value is
 * intentional: folding it into a shared fallback bucket would let one bad adapter open the
 * circuit for unrelated providers and would make incident telemetry ambiguous.
 */
export function assertProviderId(value: string): string {
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new TypeError(
      "providerId must be a stable lowercase slug (1-64 characters: a-z, 0-9, dot, dash or underscore)"
    );
  }
  return value;
}

/** Small provider-isolation primitive; keys are fixed adapter IDs, never user-controlled URLs. */
export class ProviderCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(
    private readonly options: {
      failureThreshold?: number;
      openMs?: number;
      maxProviders?: number;
      now?: () => number;
    } = {}
  ) {}

  tryAcquire(provider: string): boolean {
    const key = this.key(provider);
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry) {
      this.ensureCapacity();
      this.entries.set(key, this.empty());
      return true;
    }
    if (entry.openUntil > now) return false;
    if (entry.consecutiveFailures < this.threshold()) return true;
    if (entry.halfOpenInFlight) return false;
    entry.halfOpenInFlight = true;
    return true;
  }

  success(provider: string): void {
    const key = this.key(provider);
    const entry = this.entries.get(key) ?? this.empty();
    entry.consecutiveFailures = 0;
    entry.openUntil = 0;
    entry.halfOpenInFlight = false;
    entry.lastSuccessAt = this.now();
    this.entries.set(key, entry);
  }

  failure(provider: string): void {
    const key = this.key(provider);
    const existed = this.entries.has(key);
    const entry = this.entries.get(key) ?? this.empty();
    entry.consecutiveFailures += 1;
    entry.lastFailureAt = this.now();
    if (entry.halfOpenInFlight || entry.consecutiveFailures >= this.threshold()) {
      entry.openUntil = this.now() + this.openMs();
    }
    entry.halfOpenInFlight = false;
    if (!existed) this.ensureCapacity();
    this.entries.set(key, entry);
  }

  /** Caller navigation/cancellation is not evidence that the provider is unhealthy. */
  aborted(provider: string): void {
    const key = this.key(provider);
    const entry = this.entries.get(key);
    if (entry) entry.halfOpenInFlight = false;
  }

  snapshots(): CircuitSnapshot[] {
    const now = this.now();
    return [...this.entries.entries()]
      .map(([provider, entry]) => ({
        provider,
        state:
          entry.openUntil > now
            ? ("open" as const)
            : entry.consecutiveFailures >= this.threshold()
              ? ("half-open" as const)
              : ("closed" as const),
        consecutiveFailures: entry.consecutiveFailures,
        retryAt: entry.openUntil > now ? new Date(entry.openUntil).toISOString() : null,
        lastSuccessAt:
          entry.lastSuccessAt === null ? null : new Date(entry.lastSuccessAt).toISOString(),
        lastFailureAt:
          entry.lastFailureAt === null ? null : new Date(entry.lastFailureAt).toISOString()
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  clear(): void {
    this.entries.clear();
  }

  private empty(): CircuitEntry {
    return {
      consecutiveFailures: 0,
      openUntil: 0,
      halfOpenInFlight: false,
      lastSuccessAt: null,
      lastFailureAt: null
    };
  }

  private key(value: string): string {
    return assertProviderId(value);
  }

  private threshold(): number {
    return Math.min(20, Math.max(1, this.options.failureThreshold ?? 4));
  }

  private openMs(): number {
    return Math.min(10 * 60_000, Math.max(1_000, this.options.openMs ?? 30_000));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private ensureCapacity(): void {
    const maxProviders = Math.min(512, Math.max(1, this.options.maxProviders ?? 128));
    if (this.entries.size < maxProviders) return;
    const oldest = this.entries.keys().next().value;
    if (oldest) this.entries.delete(oldest);
  }
}
