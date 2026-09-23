import {
  assertPlanDocumentV2,
  canonicalPlanRoutingPolicy,
  planRoutePolicyHash,
  stablePlanHash,
  type JsonValue,
  type PlanDocumentV2,
  type PlanRoutePreferenceV2,
  type PlanTravelProfileV2,
  type PlanVehicleV2,
  type Position,
  type RouteAlternativeV2
} from "@mapos/layer-sdk";

export interface AdjacentRouteRequest {
  /** A tuple by contract: provider adapters can never receive whole-plan waypoints. */
  endpoints: readonly [Position, Position];
  profile: PlanTravelProfileV2;
  preference: PlanRoutePreferenceV2;
  avoid: readonly string[];
  vehicle?: PlanVehicleV2 | null;
  signal?: AbortSignal;
}

export interface AdjacentProviderAlternative {
  id?: string;
  profile?: string;
  geometry: { type: "LineString"; coordinates: Position[] };
  distanceM: number;
  durationS: number;
  departureAt?: string | null;
  arrivalAt?: string | null;
  warnings?: string[];
  restrictions?: JsonValue[];
  toll?: JsonValue;
  weather?: JsonValue;
}

export interface AdjacentRouteResponse {
  alternatives: AdjacentProviderAlternative[];
  warnings?: string[];
  partial?: boolean;
}

export interface AdjacentRouteProvider {
  id: string;
  route(request: AdjacentRouteRequest): Promise<AdjacentRouteResponse>;
}

interface CachedSegmentRoute {
  providerId: string;
  fingerprint: string;
  profile: string;
  alternatives: RouteAlternativeV2[];
  warnings: string[];
  partial: boolean;
  calculatedAt: string;
}

interface CacheEntry {
  expiresAt: number;
  value?: CachedSegmentRoute;
  pending?: Promise<CachedSegmentRoute>;
}

export interface SegmentRouteCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Bounded LRU cache that also coalesces identical in-flight adjacent-segment calls. */
export class SegmentRouteCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: SegmentRouteCacheOptions = {}) {
    const requestedMaximum = options.maxEntries ?? 2_048;
    this.maxEntries = Number.isFinite(requestedMaximum)
      ? Math.min(20_000, Math.max(1, Math.floor(requestedMaximum)))
      : 2_048;
    const requestedTtl = options.ttlMs ?? 60 * 60 * 1_000;
    this.ttlMs = Number.isFinite(requestedTtl)
      ? Math.min(24 * 60 * 60 * 1_000, Math.max(1, Math.floor(requestedTtl)))
      : 60 * 60 * 1_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  async resolve(
    key: string,
    load: () => Promise<CachedSegmentRoute>
  ): Promise<{ value: CachedSegmentRoute; cacheHit: boolean }> {
    const timestamp = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > timestamp) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      if (existing.value) return { value: clone(existing.value), cacheHit: true };
      if (existing.pending) return { value: clone(await existing.pending), cacheHit: true };
    } else if (existing) {
      this.entries.delete(key);
    }

    const pending = load();
    const entry: CacheEntry = { expiresAt: timestamp + this.ttlMs, pending };
    this.entries.set(key, entry);
    this.trim();
    try {
      const value = await pending;
      if (this.entries.get(key) === entry) {
        entry.value = clone(value);
        delete entry.pending;
        entry.expiresAt = this.now() + this.ttlMs;
      }
      return { value: clone(value), cacheHit: false };
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

const defaultSegmentRouteCache = new SegmentRouteCache();

export interface RoutePlanSegmentsOptions {
  concurrency?: number;
  cache?: SegmentRouteCache;
  signal?: AbortSignal;
  now?: () => string;
}

export interface RoutePlanSegmentsResult {
  plan: PlanDocumentV2;
  routedSegmentIds: string[];
  failedSegmentIds: string[];
  stats: {
    eligibleSegments: number;
    providerCalls: number;
    cacheHits: number;
    maxConcurrency: number;
  };
}

function timestamp(now: (() => string) | undefined): string {
  const value = now?.() ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(value)))
    throw new TypeError("Routing clock returned an invalid date-time.");
  return new Date(value).toISOString();
}

function routeKey(
  plan: PlanDocumentV2,
  providerId: string,
  endpoints: [Position, Position]
): string {
  return JSON.stringify({
    version: 1,
    providerId,
    endpoints,
    routing: JSON.parse(canonicalPlanRoutingPolicy(plan.routePolicy, plan.vehicle))
  });
}

function validPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function normalizeProviderResponse(
  response: AdjacentRouteResponse,
  provider: AdjacentRouteProvider,
  plan: PlanDocumentV2,
  fingerprint: string,
  calculatedAt: string
): CachedSegmentRoute {
  if (!Array.isArray(response.alternatives) || response.alternatives.length === 0) {
    throw new TypeError("Adjacent route provider returned no alternatives.");
  }
  const ids = new Set<string>();
  const alternatives = response.alternatives.map((alternative, index): RouteAlternativeV2 => {
    if (
      alternative.geometry?.type !== "LineString" ||
      !Array.isArray(alternative.geometry.coordinates) ||
      alternative.geometry.coordinates.length < 2 ||
      !alternative.geometry.coordinates.every(validPosition)
    ) {
      throw new TypeError("Adjacent route provider returned invalid geometry.");
    }
    if (
      !Number.isFinite(alternative.distanceM) ||
      alternative.distanceM < 0 ||
      !Number.isFinite(alternative.durationS) ||
      alternative.durationS < 0
    ) {
      throw new TypeError("Adjacent route provider returned invalid route metrics.");
    }
    const id = alternative.id?.trim() || `alternative:${fingerprint}:${index}`;
    if (ids.has(id))
      throw new TypeError("Adjacent route provider returned duplicate alternative ids.");
    ids.add(id);
    return {
      id,
      providerId: provider.id,
      profile: alternative.profile ?? plan.routePolicy.profile,
      preference: plan.routePolicy.preference,
      geometry: clone(alternative.geometry),
      distanceM: alternative.distanceM,
      durationS: alternative.durationS,
      ...(alternative.departureAt !== undefined ? { departureAt: alternative.departureAt } : {}),
      ...(alternative.arrivalAt !== undefined ? { arrivalAt: alternative.arrivalAt } : {}),
      warnings: [...(response.warnings ?? []), ...(alternative.warnings ?? [])],
      ...(alternative.restrictions !== undefined
        ? { restrictions: clone(alternative.restrictions) }
        : {}),
      ...(alternative.toll !== undefined ? { toll: clone(alternative.toll) } : {}),
      ...(alternative.weather !== undefined ? { weather: clone(alternative.weather) } : {}),
      computedAt: calculatedAt
    };
  });
  return {
    providerId: provider.id,
    fingerprint,
    profile: alternatives[0]!.profile,
    alternatives,
    warnings: [...(response.warnings ?? [])],
    partial: response.partial === true,
    calculatedAt
  };
}

function abortError(): Error {
  const error = new Error("Segment routing was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Routes only pending/stale/failed segments through a bounded worker queue. The provider surface
 * accepts exactly two endpoints, so a 250-stop plan becomes 249 independent calls, never one
 * oversized waypoint request. A failed segment is retained and does not fail the remaining plan.
 */
export async function routePlanSegments(
  document: PlanDocumentV2,
  provider: AdjacentRouteProvider,
  options: RoutePlanSegmentsOptions = {}
): Promise<RoutePlanSegmentsResult> {
  assertPlanDocumentV2(document);
  if (!provider.id.trim()) throw new TypeError("Adjacent route provider id is required.");
  const next = clone(document);
  const expectedPolicyHash = planRoutePolicyHash(next.routePolicy, next.vehicle);
  const eligible = next.segments
    .map((segment, index) => ({ segment, index }))
    .filter(
      ({ segment }) =>
        segment.status !== "ready" ||
        segment.policyHash !== expectedPolicyHash ||
        segment.selectedAlternativeId == null ||
        segment.alternatives.find((a) => a.id === segment.selectedAlternativeId)?.providerId !==
          provider.id
    );
  const requestedConcurrency = options.concurrency ?? 4;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(16, Math.max(1, Math.floor(requestedConcurrency)))
    : 4;
  const cache = options.cache ?? defaultSegmentRouteCache;
  const routedSegmentIds: string[] = [];
  const failedSegmentIds: string[] = [];
  let cursor = 0;
  let active = 0;
  let maxConcurrency = 0;
  let providerCalls = 0;
  let cacheHits = 0;

  async function routeOne(index: number): Promise<void> {
    if (options.signal?.aborted) throw abortError();
    const segment = next.segments[index]!;
    const from = next.stops[segment.order]!;
    const to = next.stops[segment.order + 1]!;
    const endpoints: [Position, Position] = [
      [...from.location.coordinates] as Position,
      [...to.location.coordinates] as Position
    ];
    const key = routeKey(next, provider.id, endpoints);
    const fingerprint = `segment-route-v1:${stablePlanHash(key)}`;
    try {
      const resolved = await cache.resolve(key, async () => {
        providerCalls += 1;
        const calculatedAt = timestamp(options.now);
        const response = await provider.route({
          endpoints,
          profile: next.routePolicy.profile,
          preference: next.routePolicy.preference,
          avoid: [...(next.routePolicy.avoid ?? [])],
          vehicle: next.vehicle,
          signal: options.signal
        });
        if (options.signal?.aborted) throw abortError();
        return normalizeProviderResponse(response, provider, next, fingerprint, calculatedAt);
      });
      if (resolved.cacheHit) cacheHits += 1;
      const selected = resolved.value.alternatives.some(
        (alternative) => alternative.id === segment.selectedAlternativeId
      )
        ? segment.selectedAlternativeId!
        : resolved.value.alternatives[0]!.id;
      next.segments[index] = {
        ...segment,
        policyHash: expectedPolicyHash,
        status: resolved.value.partial ? "partial" : "ready",
        provider: resolved.value.providerId,
        providerRequestFingerprint: resolved.value.fingerprint,
        profile: resolved.value.profile,
        alternatives: clone(resolved.value.alternatives),
        selectedAlternativeId: selected,
        warnings: [...resolved.value.warnings],
        calculatedAt: resolved.value.calculatedAt,
        staleReason: null
      };
      routedSegmentIds.push(segment.id);
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      next.segments[index] = {
        ...segment,
        policyHash: expectedPolicyHash,
        status: "failed",
        warnings: ["Routing tohoto segmentu se nezdařil; ostatní části plánu zůstávají dostupné."],
        staleReason: "routing-failed"
      };
      failedSegmentIds.push(segment.id);
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const task = eligible[cursor++];
      if (!task) return;
      active += 1;
      maxConcurrency = Math.max(maxConcurrency, active);
      try {
        await routeOne(task.index);
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, eligible.length) }, () => worker()));
  if (eligible.length > 0) next.updatedAt = timestamp(options.now);
  assertPlanDocumentV2(next);
  return {
    plan: next,
    routedSegmentIds: routedSegmentIds.sort(),
    failedSegmentIds: failedSegmentIds.sort(),
    stats: {
      eligibleSegments: eligible.length,
      providerCalls,
      cacheHits,
      maxConcurrency
    }
  };
}
