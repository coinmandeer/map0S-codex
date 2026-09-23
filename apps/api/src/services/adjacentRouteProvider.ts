import type { DataProvider, Position } from "@mapos/layer-sdk";
import { resolvePlanRoutingRequestV2 } from "@mapos/layer-sdk";
import { fetchRouteAlternatives, type RouteResult } from "./routingService.js";
import { fetchBrouterRoutes, isBrouterProfile } from "./brouterService.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import type { AdjacentRouteProvider, AdjacentRouteRequest } from "./segmentRoutingService.js";

function encodedPoint(position: Position): string {
  return `${position[0]},${position[1]}`;
}

type RouteFetcher = typeof fetchRouteAlternatives;
type BrouterFetcher = typeof fetchBrouterRoutes;

export interface AdjacentRouteProviderOptions {
  routeFetcher?: RouteFetcher;
  /** The adventure router, injected so a test can exercise the branch without a network call. */
  brouterFetcher?: BrouterFetcher;
}

export function createAdjacentRouteProvider(
  provider: DataProvider,
  options: AdjacentRouteProviderOptions | RouteFetcher = {}
): AdjacentRouteProvider {
  const { routeFetcher = fetchRouteAlternatives, brouterFetcher = fetchBrouterRoutes } =
    typeof options === "function" ? { routeFetcher: options } : options;
  return {
    id: `mapos-routing:${provider}:v2`,
    async route(request) {
      const mapping = resolvePlanRoutingRequestV2(
        provider,
        request.profile,
        request.preference,
        request.avoid
      );

      // "Dobrodružná" on foot or by bike is BRouter's question to answer (§16.6). If it cannot,
      // the segment still gets a route from the plan's own provider, and says so.
      const adventure =
        mapping.adventureRouter === "brouter" && isBrouterProfile(mapping.providerProfile)
          ? await adventureRoutes(brouterFetcher, request, mapping.providerProfile)
          : null;
      if (adventure) {
        return {
          alternatives: adventure.map((result, index) => ({
            id: `provider-route-${index + 1}`,
            profile: result.profile,
            geometry: { type: "LineString", coordinates: result.coordinates },
            distanceM: result.distanceM,
            durationS: result.durationS,
            warnings: index === 0 ? [] : ["Alternativní trasa"]
          }))
        };
      }

      const results = await routeFetcher(
        encodedPoint(request.endpoints[0]),
        encodedPoint(request.endpoints[1]),
        // A trekking profile means nothing to OSRM or Mapy, so the fallback asks them for the way
        // of travelling that was requested in the first place.
        isBrouterProfile(mapping.providerProfile)
          ? request.profile === "bike"
            ? "bike"
            : "foot"
          : mapping.providerProfile,
        {
          provider,
          avoidToll: mapping.avoidTolls,
          alternatives: 2
        }
      );
      const primary = results[0];
      if (!primary) throw new TypeError("Route provider returned no adjacent route.");
      const fallbackWarnings =
        mapping.adventureRouter === "brouter"
          ? [...mapping.warnings, "BRouter nebyl dostupný; úsek počítal běžný profil."]
          : primary.provider === provider
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

/** BRouter's answer for one segment, or `null` when it has none and the ordinary provider has to
 *  speak instead. */
async function adventureRoutes(
  fetcher: BrouterFetcher,
  request: AdjacentRouteRequest,
  profile: "trekking" | "mtb"
): Promise<RouteResult[] | null> {
  try {
    const routes = await fetcher({
      points: request.endpoints.map(encodedPoint),
      profile,
      alternatives: 2
    });
    if (!routes.length) return null;
    return routes.map((route) => ({
      coordinates: route.coordinates,
      distanceM: route.distanceM,
      durationS: route.durationS,
      provider: "osm" as const,
      profile,
      ...(route.elevation ? { elevation: route.elevation } : {})
    }));
  } catch (error) {
    console.warn("BRouter routing failed; using the plan provider", safeErrorLogFields(error));
    return null;
  }
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
