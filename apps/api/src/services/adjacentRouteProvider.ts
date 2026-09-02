import type { DataProvider, Position } from "@mapos/layer-sdk";
import { resolvePlanRoutingRequestV2 } from "@mapos/layer-sdk";
import { fetchRouteAlternatives } from "./routingService.js";
import type { AdjacentRouteProvider, AdjacentRouteRequest } from "./segmentRoutingService.js";

function encodedPoint(position: Position): string {
  return `${position[0]},${position[1]}`;
}

type RouteFetcher = typeof fetchRouteAlternatives;

export function createAdjacentRouteProvider(
  provider: DataProvider,
  routeFetcher: RouteFetcher = fetchRouteAlternatives
): AdjacentRouteProvider {
  return {
    id: `mapos-routing:${provider}`,
    async route(request) {
      const mapping = resolvePlanRoutingRequestV2(
        provider,
        request.profile,
        request.preference,
        request.avoid
      );
      const results = await routeFetcher(
        encodedPoint(request.endpoints[0]),
        encodedPoint(request.endpoints[1]),
        mapping.providerProfile,
        {
          provider,
          avoidToll: mapping.avoidTolls,
          alternatives: 2
        }
      );
      const primary = results[0];
      if (!primary) throw new TypeError("Route provider returned no adjacent route.");
      const fallbackWarnings =
        primary.provider === provider
          ? mapping.warnings
          : [
              ...mapping.warnings,
              ...resolvePlanRoutingRequestV2(
                primary.provider,
                request.profile,
                request.preference,
                request.avoid
              ).warnings,
              `Provider ${provider} nebyl dostupný; segment použil ${primary.provider}.`
            ];
      return {
        alternatives: results.map((result, index) => ({
          id: `provider-route-${index + 1}`,
          profile: result.profile,
          geometry: { type: "LineString", coordinates: result.coordinates },
          distanceM: result.distanceM,
          durationS: result.durationS,
          warnings: index === 0 ? fallbackWarnings : [...fallbackWarnings, "Alternativní trasa"]
        }))
      };
    }
  };
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters([first, second]: AdjacentRouteRequest["endpoints"]): number {
  const deltaLatitude = radians(second[1] - first[1]);
  const deltaLongitude = radians(second[0] - first[0]);
  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(first[1])) * Math.cos(radians(second[1])) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

/** Deterministic memory/offline provider; it never touches fetch or another process. */
export function createMemoryAdjacentRouteProvider(): AdjacentRouteProvider {
  return {
    id: "memory-adjacent-routing",
    async route(request) {
      const distanceM = Math.round(distanceMeters(request.endpoints));
      const speedKmh = request.profile === "foot" ? 5 : request.profile === "bike" ? 18 : 70;
      return {
        alternatives: [
          {
            profile: request.profile,
            geometry: {
              type: "LineString",
              coordinates: request.endpoints.map((position) => [...position] as Position)
            },
            distanceM,
            durationS: Math.max(60, Math.round((distanceM / 1_000 / speedKmh) * 3_600)),
            warnings: []
          }
        ]
      };
    }
  };
}
