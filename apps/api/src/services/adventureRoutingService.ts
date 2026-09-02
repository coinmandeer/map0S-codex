import type { Bbox, OsmPoiCategoryId, Place, PlanDocumentV2, Position } from "@mapos/layer-sdk";
import type { AdjacentRouteProvider, AdjacentRouteRequest } from "./segmentRoutingService.js";

export const ADVENTURE_ALGORITHM_VERSION = "mapos-adventure-v1";
export const ADVENTURE_CATEGORIES = [
  "viewpoint",
  "waterfall",
  "peak",
  "cave",
  "castle",
  "palace",
  "ruins",
  "museum",
  "monument",
  "alpine_hut"
] as const satisfies readonly OsmPoiCategoryId[];

const CATEGORY_INTEREST: Readonly<Record<(typeof ADVENTURE_CATEGORIES)[number], number>> = {
  viewpoint: 100,
  waterfall: 98,
  peak: 94,
  cave: 92,
  castle: 96,
  palace: 84,
  ruins: 88,
  museum: 76,
  monument: 68,
  alpine_hut: 82
};

const MAX_SCANNED_SEGMENTS = 6;
const MAX_PREFILTERED_CANDIDATES = 12;
const MAX_RETURNED_SUGGESTIONS = 3;
const MIN_ENDPOINT_DISTANCE_M = 180;

export interface AdventureCorridorQuery {
  segmentIndex: number;
  bbox: Bbox;
  categories: readonly OsmPoiCategoryId[];
}

export interface AdventurePlaceSearchResult {
  places: Place[];
  sourceStates?: Array<{ source: string; state: string; count: number }>;
}

export interface AdventureCandidate {
  id: string;
  placeId: string;
  name: string;
  category: string;
  location: Position;
  segmentIndex: number;
  insertIndex: number;
  score: number;
  scoreBreakdown: {
    interest: number;
    detourEfficiency: number;
    sourceConfidence: number;
  };
  baselineDistanceM: number;
  viaDistanceM: number;
  detourM: number;
  detourPercent: number;
  source: { id: string; reference: string | null };
  explanation: string;
}

export interface AdventureRecommendation {
  algorithm: {
    version: typeof ADVENTURE_ALGORITHM_VERSION;
    deterministic: true;
    formula: string;
    detourLimitPercent: number;
    minimumEndpointDistanceM: number;
  };
  suggestions: AdventureCandidate[];
  coverage: {
    totalSegments: number;
    scannedSegments: number;
    placesEvaluated: number;
    eligiblePlaces: number;
  };
  dataBudget: {
    sources: ["osm"];
    categories: readonly OsmPoiCategoryId[];
    maxScannedSegments: number;
    maxRoutedCandidates: number;
    maxReturnedSuggestions: number;
    providerCalls: number;
  };
  sourceStates: Array<{ source: string; state: string; count: number }>;
  warnings: string[];
}

export interface AdventureRecommendationOptions {
  detourLimitPercent?: number;
  maximumSuggestions?: number;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceMeters(a: Position, b: Position): number {
  const deltaLatitude = radians(b[1] - a[1]);
  const deltaLongitude = radians(b[0] - a[0]);
  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function normalizedDetourLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 15;
  return Math.min(30, Math.max(5, Math.round(Number(value))));
}

function segmentEndpoints(plan: PlanDocumentV2, segmentIndex: number): [Position, Position] {
  const from = plan.stops[segmentIndex]?.location.coordinates;
  const to = plan.stops[segmentIndex + 1]?.location.coordinates;
  if (!from || !to) throw new TypeError("Adventure segment does not have two stops.");
  return [from, to];
}

function corridorBbox(endpoints: [Position, Position], detourLimitPercent: number): Bbox {
  const directDistanceM = distanceMeters(...endpoints);
  const paddingM = Math.min(12_000, Math.max(1_500, directDistanceM * (detourLimitPercent / 100)));
  const midpointLatitude = (endpoints[0][1] + endpoints[1][1]) / 2;
  const latitudePadding = paddingM / 111_320;
  const longitudePadding =
    paddingM / Math.max(20_000, 111_320 * Math.cos(radians(midpointLatitude)));
  return [
    Math.max(-180, Math.min(endpoints[0][0], endpoints[1][0]) - longitudePadding),
    Math.max(-85, Math.min(endpoints[0][1], endpoints[1][1]) - latitudePadding),
    Math.min(180, Math.max(endpoints[0][0], endpoints[1][0]) + longitudePadding),
    Math.min(85, Math.max(endpoints[0][1], endpoints[1][1]) + latitudePadding)
  ];
}

/** Longest segments yield the broadest useful search while a hard cap keeps Overpass and mobile
 * response costs finite. Ties use segment order, so the same plan always produces the same query. */
export function buildAdventureCorridors(
  plan: PlanDocumentV2,
  detourLimitPercent = 15
): AdventureCorridorQuery[] {
  const limit = normalizedDetourLimit(detourLimitPercent);
  return Array.from({ length: Math.max(0, plan.stops.length - 1) }, (_, segmentIndex) => {
    const endpoints = segmentEndpoints(plan, segmentIndex);
    return {
      segmentIndex,
      distanceM: distanceMeters(...endpoints),
      bbox: corridorBbox(endpoints, limit)
    };
  })
    .sort((a, b) => b.distanceM - a.distanceM || a.segmentIndex - b.segmentIndex)
    .slice(0, MAX_SCANNED_SEGMENTS)
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map(({ segmentIndex, bbox }) => ({
      segmentIndex,
      bbox,
      categories: ADVENTURE_CATEGORIES
    }));
}

interface PrefilteredPlace {
  place: Place;
  segmentIndex: number;
  directDistanceM: number;
  estimatedDetourM: number;
  estimatedDetourPercent: number;
  interest: number;
  sourceConfidence: number;
}

function categoryInterest(category: string): number | null {
  return category in CATEGORY_INTEREST
    ? CATEGORY_INTEREST[category as keyof typeof CATEGORY_INTEREST]
    : null;
}

function prefilterPlaces(
  plan: PlanDocumentV2,
  places: Place[],
  scannedSegmentIndexes: readonly number[],
  detourLimitPercent: number
): PrefilteredPlace[] {
  const existingStopIds = new Set(
    plan.stops.map((stop) => stop.sourceFeatureId).filter((id): id is string => Boolean(id))
  );
  const unique = new Map(places.map((place) => [place.id, place]));
  const ranked: PrefilteredPlace[] = [];

  for (const place of unique.values()) {
    if (existingStopIds.has(place.id)) continue;
    const interest = categoryInterest(place.category);
    if (interest === null) continue;
    const location: Position = [place.lng, place.lat];
    let best: PrefilteredPlace | null = null;
    for (const segmentIndex of scannedSegmentIndexes) {
      const endpoints = segmentEndpoints(plan, segmentIndex);
      const fromDistance = distanceMeters(endpoints[0], location);
      const toDistance = distanceMeters(location, endpoints[1]);
      if (Math.min(fromDistance, toDistance) < MIN_ENDPOINT_DISTANCE_M) continue;
      const directDistanceM = Math.max(1, distanceMeters(...endpoints));
      const estimatedDetourM = Math.max(0, fromDistance + toDistance - directDistanceM);
      const estimatedDetourPercent = (estimatedDetourM / directDistanceM) * 100;
      // Geodesic prefilter is deliberately looser than the published road-route cap. Actual
      // provider distances below make the final decision.
      if (estimatedDetourPercent > Math.max(12, detourLimitPercent * 1.8)) continue;
      const candidate: PrefilteredPlace = {
        place,
        segmentIndex,
        directDistanceM,
        estimatedDetourM,
        estimatedDetourPercent,
        interest,
        sourceConfidence: Math.round(
          Math.max(0, Math.min(1, place.sources[0]?.confidence ?? 0.5)) * 100
        )
      };
      if (
        !best ||
        candidate.estimatedDetourPercent < best.estimatedDetourPercent ||
        (candidate.estimatedDetourPercent === best.estimatedDetourPercent &&
          candidate.segmentIndex < best.segmentIndex)
      ) {
        best = candidate;
      }
    }
    if (best) ranked.push(best);
  }

  return ranked
    .sort(
      (a, b) =>
        b.interest - a.interest ||
        a.estimatedDetourPercent - b.estimatedDetourPercent ||
        b.sourceConfidence - a.sourceConfidence ||
        a.place.name.localeCompare(b.place.name, "cs") ||
        a.place.id.localeCompare(b.place.id)
    )
    .slice(0, MAX_PREFILTERED_CANDIDATES);
}

function selectedSegmentDistance(plan: PlanDocumentV2, segmentIndex: number): number | null {
  const segment = plan.segments[segmentIndex];
  if (!segment || segment.status !== "ready") return null;
  const selected =
    segment.alternatives.find((candidate) => candidate.id === segment.selectedAlternativeId) ??
    segment.alternatives[0];
  return selected?.distanceM ?? null;
}

function routeRequest(plan: PlanDocumentV2, endpoints: [Position, Position]): AdjacentRouteRequest {
  return {
    endpoints,
    profile: plan.routePolicy.profile,
    preference: plan.routePolicy.preference,
    avoid: plan.routePolicy.avoid ?? [],
    vehicle: plan.vehicle
  };
}

async function primaryDistance(
  provider: AdjacentRouteProvider,
  plan: PlanDocumentV2,
  endpoints: [Position, Position]
): Promise<number> {
  const response = await provider.route(routeRequest(plan, endpoints));
  const distance = response.alternatives[0]?.distanceM;
  if (!Number.isFinite(distance) || distance === undefined || distance < 0) {
    throw new TypeError("Adventure route provider returned no valid distance.");
  }
  return distance;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maximum: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(maximum, items.length) }, async () => {
    let index: number;
    while ((index = nextIndex++) < items.length) results[index] = await work(items[index]!);
  });
  await Promise.all(workers);
  return results;
}

/** Ranks interesting places deterministically, then verifies every returned detour with the same
 * adjacent-route provider used by the plan. No random waypoint or AI model participates. */
export async function recommendAdventureRoute(
  plan: PlanDocumentV2,
  search: AdventurePlaceSearchResult,
  provider: AdjacentRouteProvider,
  options: AdventureRecommendationOptions = {}
): Promise<AdventureRecommendation> {
  const detourLimitPercent = normalizedDetourLimit(options.detourLimitPercent);
  const corridors = buildAdventureCorridors(plan, detourLimitPercent);
  const maximumSuggestions = Math.min(
    MAX_RETURNED_SUGGESTIONS,
    Math.max(1, Math.floor(options.maximumSuggestions ?? MAX_RETURNED_SUGGESTIONS))
  );
  const prefiltered = prefilterPlaces(
    plan,
    search.places,
    corridors.map((corridor) => corridor.segmentIndex),
    detourLimitPercent
  );
  const baselineBySegment = new Map<number, Promise<number>>();
  let providerCalls = 0;
  const warnings: string[] = [];

  const baselineDistance = (segmentIndex: number): Promise<number> => {
    const existing = selectedSegmentDistance(plan, segmentIndex);
    if (existing !== null) return Promise.resolve(existing);
    const cached = baselineBySegment.get(segmentIndex);
    if (cached) return cached;
    providerCalls += 1;
    const request = primaryDistance(provider, plan, segmentEndpoints(plan, segmentIndex));
    baselineBySegment.set(segmentIndex, request);
    return request;
  };

  const evaluated = await mapWithConcurrency(
    prefiltered,
    3,
    async (candidate): Promise<AdventureCandidate | null> => {
      try {
        const endpoints = segmentEndpoints(plan, candidate.segmentIndex);
        const location: Position = [candidate.place.lng, candidate.place.lat];
        providerCalls += 2;
        const [baselineDistanceM, firstLegM, secondLegM] = await Promise.all([
          baselineDistance(candidate.segmentIndex),
          primaryDistance(provider, plan, [endpoints[0], location]),
          primaryDistance(provider, plan, [location, endpoints[1]])
        ]);
        const viaDistanceM = firstLegM + secondLegM;
        const detourM = Math.max(0, viaDistanceM - baselineDistanceM);
        const detourPercent = baselineDistanceM > 0 ? (detourM / baselineDistanceM) * 100 : 100;
        if (detourPercent > detourLimitPercent) return null;
        const detourEfficiency = Math.round(
          Math.max(0, 100 * (1 - detourPercent / detourLimitPercent))
        );
        const score = Math.round(
          candidate.interest * 0.55 + detourEfficiency * 0.35 + candidate.sourceConfidence * 0.1
        );
        const primarySource = candidate.place.sources[0];
        return {
          id: `adventure:${candidate.segmentIndex}:${candidate.place.id}`,
          placeId: candidate.place.id,
          name: candidate.place.name,
          category: candidate.place.category,
          location,
          segmentIndex: candidate.segmentIndex,
          insertIndex: candidate.segmentIndex + 1,
          score,
          scoreBreakdown: {
            interest: candidate.interest,
            detourEfficiency,
            sourceConfidence: candidate.sourceConfidence
          },
          baselineDistanceM: Math.round(baselineDistanceM),
          viaDistanceM: Math.round(viaDistanceM),
          detourM: Math.round(detourM),
          detourPercent: Number(detourPercent.toFixed(1)),
          source: {
            id: primarySource?.source ?? "unknown",
            reference: primarySource?.sourceRef ?? null
          },
          explanation: `55 % zajímavost · 35 % efektivita zajížďky · 10 % důvěra zdroje`
        };
      } catch {
        return null;
      }
    }
  );

  const accepted = evaluated
    .filter((candidate): candidate is AdventureCandidate => candidate !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.detourPercent - b.detourPercent ||
        a.segmentIndex - b.segmentIndex ||
        a.name.localeCompare(b.name, "cs") ||
        a.placeId.localeCompare(b.placeId)
    );
  const usedSegments = new Set<number>();
  const suggestions: AdventureCandidate[] = [];
  for (const candidate of accepted) {
    if (usedSegments.has(candidate.segmentIndex)) continue;
    usedSegments.add(candidate.segmentIndex);
    suggestions.push(candidate);
    if (suggestions.length >= maximumSuggestions) break;
  }
  if (prefiltered.length > 0 && accepted.length === 0) {
    warnings.push("Žádné nalezené místo neprošlo skutečným limitem zajížďky.");
  }
  if (corridors.length < plan.segments.length) {
    warnings.push(
      `Kvůli datovému rozpočtu bylo prohledáno ${corridors.length} z ${plan.segments.length} nejdelších úseků.`
    );
  }

  return {
    algorithm: {
      version: ADVENTURE_ALGORITHM_VERSION,
      deterministic: true,
      formula: "0.55 × zajímavost + 0.35 × efektivita zajížďky + 0.10 × důvěra zdroje",
      detourLimitPercent,
      minimumEndpointDistanceM: MIN_ENDPOINT_DISTANCE_M
    },
    suggestions,
    coverage: {
      totalSegments: plan.segments.length,
      scannedSegments: corridors.length,
      placesEvaluated: search.places.length,
      eligiblePlaces: accepted.length
    },
    dataBudget: {
      sources: ["osm"],
      categories: ADVENTURE_CATEGORIES,
      maxScannedSegments: MAX_SCANNED_SEGMENTS,
      maxRoutedCandidates: MAX_PREFILTERED_CANDIDATES,
      maxReturnedSuggestions: MAX_RETURNED_SUGGESTIONS,
      providerCalls
    },
    sourceStates: search.sourceStates ?? [],
    warnings
  };
}
