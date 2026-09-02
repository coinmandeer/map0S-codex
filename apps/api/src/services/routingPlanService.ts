import { nanoid } from "nanoid";
import type {
  DataProvider,
  TripLeg,
  TripPlan,
  TripPlanResult,
  TripPlanVariantResult,
  TripRouteVariant,
  TripStop,
  TripTravelProfile
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { fetchRoute } from "./routingService.js";
import { checkTripRestrictions } from "./tripRestrictionService.js";
import { estimateTripToll } from "./tripTollService.js";
import { weatherForTripStops } from "./tripWeatherService.js";

const VARIANTS: TripRouteVariant[] = ["fast", "short", "nohwy"];

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStop(value: Partial<TripStop>, index: number): TripStop {
  const lng = finite(value.lng, Number.NaN);
  const lat = finite(value.lat, Number.NaN);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) {
    throw new ClientError(`Neplatná poloha zastávky ${index + 1}`);
  }
  return {
    id: String(value.id || `stop-${index + 1}`).slice(0, 80),
    name: String(value.name || `Zastávka ${index + 1}`)
      .trim()
      .slice(0, 160),
    lng,
    lat,
    dwellMinutes: Math.max(0, Math.min(7 * 24 * 60, Math.round(finite(value.dwellMinutes))))
  };
}

export function normalizeTripPlan(input: Partial<TripPlan>): TripPlan {
  const stops = Array.isArray(input.stops) ? input.stops : [];
  if (stops.length < 2 || stops.length > 60) {
    throw new ClientError("Plán musí mít 2 až 60 zastávek");
  }
  const departure = new Date(input.departureAt ?? Date.now());
  if (!Number.isFinite(departure.getTime())) throw new ClientError("Neplatný čas odjezdu");
  const profile: TripTravelProfile = ["foot", "bike", "car", "moto", "camper", "truck"].includes(
    String(input.vehicle?.profile)
  )
    ? (input.vehicle!.profile as TripTravelProfile)
    : "car";
  const variant = VARIANTS.includes(input.variant as TripRouteVariant) ? input.variant! : "fast";
  return {
    id: String(input.id || `plan-${nanoid(10)}`).slice(0, 80),
    name: String(input.name || "Nový plán")
      .trim()
      .slice(0, 160),
    departureAt: departure.toISOString(),
    variant,
    stops: stops.map(normalizeStop),
    vehicle: {
      profile,
      heightM:
        input.vehicle?.heightM == null
          ? null
          : Math.max(0, Math.min(6, finite(input.vehicle.heightM))),
      widthM:
        input.vehicle?.widthM == null
          ? null
          : Math.max(0, Math.min(4, finite(input.vehicle.widthM))),
      weightT:
        input.vehicle?.weightT == null
          ? null
          : Math.max(0, Math.min(60, finite(input.vehicle.weightT))),
      fuel: input.vehicle?.fuel ?? null,
      euroClass: input.vehicle?.euroClass ? String(input.vehicle.euroClass).slice(0, 20) : null,
      evRangeKm:
        input.vehicle?.evRangeKm == null
          ? null
          : Math.max(0, Math.min(2000, finite(input.vehicle.evRangeKm)))
    },
    visibility: ["private", "unlisted", "public"].includes(String(input.visibility))
      ? input.visibility!
      : "private",
    lastResult: input.lastResult
      ? {
          variant: VARIANTS.includes(input.lastResult.variant) ? input.lastResult.variant : variant,
          distanceM: Math.max(0, finite(input.lastResult.distanceM)),
          durationS: Math.max(0, finite(input.lastResult.durationS)),
          tollEstimatedCzk:
            input.lastResult.tollEstimatedCzk == null
              ? null
              : Math.max(0, finite(input.lastResult.tollEstimatedCzk)),
          weatherStops: Math.max(0, Math.round(finite(input.lastResult.weatherStops))),
          totalWeatherStops: Math.max(0, Math.round(finite(input.lastResult.totalWeatherStops))),
          restrictionCheck: ["checked", "unavailable", "not-applicable"].includes(
            input.lastResult.restrictionCheck
          )
            ? input.lastResult.restrictionCheck
            : "unavailable",
          restrictionWarnings: Math.max(
            0,
            Math.round(finite(input.lastResult.restrictionWarnings))
          ),
          generatedAt: Number.isFinite(new Date(input.lastResult.generatedAt).getTime())
            ? new Date(input.lastResult.generatedAt).toISOString()
            : departure.toISOString()
        }
      : undefined,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function routeProfile(profile: TripTravelProfile, variant: TripRouteVariant) {
  if (profile === "foot") return "foot_fast" as const;
  if (profile === "bike") return "bike_road" as const;
  if (variant === "short") return "car_short" as const;
  return "car_fast_traffic" as const;
}

function distanceSquared(a: [number, number], b: TripStop) {
  return (a[0] - b.lng) ** 2 + (a[1] - b.lat) ** 2;
}

function stopIndexes(coordinates: [number, number][], stops: TripStop[]) {
  const indexes = [0];
  let from = 0;
  for (const stop of stops.slice(1, -1)) {
    let best = from;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = from; index < coordinates.length; index += 1) {
      const current = distanceSquared(coordinates[index]!, stop);
      if (current < distance) {
        best = index;
        distance = current;
      }
    }
    indexes.push(best);
    from = best;
  }
  indexes.push(Math.max(0, coordinates.length - 1));
  return indexes;
}

function buildLegs(
  plan: TripPlan,
  coordinates: [number, number][],
  distanceM: number,
  durationS: number
): TripLeg[] {
  const indexes = stopIndexes(coordinates, plan.stops);
  const spans = indexes.slice(1).map((end, index) => Math.max(1, end - indexes[index]!));
  const totalSpan = spans.reduce((sum, span) => sum + span, 0);
  let cursor = new Date(plan.departureAt).getTime();
  return spans.map((span, index) => {
    const ratio = span / totalSpan;
    const legDuration = Math.round(durationS * ratio);
    const departureAt = new Date(cursor).toISOString();
    cursor += legDuration * 1000;
    const arrivalAt = new Date(cursor).toISOString();
    cursor += (plan.stops[index + 1]?.dwellMinutes ?? 0) * 60_000;
    return {
      index,
      fromStopId: plan.stops[index]!.id,
      toStopId: plan.stops[index + 1]!.id,
      coordinates: coordinates.slice(indexes[index], indexes[index + 1]! + 1),
      distanceM: Math.round(distanceM * ratio),
      durationS: legDuration,
      departureAt,
      arrivalAt
    };
  });
}

async function calculateVariant(
  plan: TripPlan,
  variant: TripRouteVariant,
  provider: DataProvider,
  includeRestrictions = true
): Promise<TripPlanVariantResult> {
  const [first, ...rest] = plan.stops;
  const last = rest.pop();
  if (!first || !last) throw new ClientError("Plán musí mít start a cíl");
  const route = await fetchRoute(
    `${first.lng},${first.lat}`,
    `${last.lng},${last.lat}`,
    routeProfile(plan.vehicle.profile, variant),
    {
      provider,
      waypoints: rest.map((stop) => `${stop.lng},${stop.lat}`),
      avoidToll: variant === "nohwy"
    }
  );
  const legs = buildLegs(plan, route.coordinates, route.distanceM, route.durationS);
  const restrictionResult = includeRestrictions
    ? await checkTripRestrictions(route.coordinates, plan.vehicle)
    : { values: [], available: false };
  const restrictionsApplicable = ["camper", "truck"].includes(plan.vehicle.profile);
  const warnings = [
    "Omezení vozidla jsou následná kontrola OSM dat, nikoliv garantovaný truck routing."
  ];
  if (variant === "nohwy") {
    warnings.push(
      "Varianta bez dálnic je v prototypu aproximována vynecháním mýta; provider nemusí vyloučit každý dálniční úsek."
    );
  }
  if (restrictionResult.values.some((restriction) => restriction.exceedsVehicle)) {
    warnings.push("Na trase jsou OSM omezení, která mohou být pro zadané vozidlo překročena.");
  }
  return {
    variant,
    provider: route.provider,
    profile: route.profile,
    coordinates: route.coordinates,
    distanceM: route.distanceM,
    durationS: route.durationS,
    legs,
    toll: estimateTripToll(route.coordinates, { ...plan, variant }),
    restrictions: restrictionResult.values,
    restrictionCheck: restrictionsApplicable
      ? restrictionResult.available
        ? "checked"
        : "unavailable"
      : "not-applicable",
    warnings
  };
}

export async function calculateTripPlan(
  input: Partial<TripPlan>,
  provider: DataProvider = "osm"
): Promise<TripPlanResult> {
  const plan = normalizeTripPlan(input);
  // Avoid tripling calls on the free OSRM fallback: it has no short/no-highway knobs, so the
  // selected route is cloned with truthful warnings. Mapy can calculate genuinely distinct paths.
  const selected = await calculateVariant(plan, plan.variant, provider);
  const variants = await Promise.all(
    VARIANTS.map(async (variant) => {
      if (variant === plan.variant) return selected;
      if (selected.provider === "osm") {
        return {
          ...selected,
          variant,
          toll: estimateTripToll(selected.coordinates, { ...plan, variant }),
          warnings: [
            ...selected.warnings,
            "Bez aktivního Mapy.com routingu používají varianty stejnou OSRM geometrii."
          ]
        };
      }
      return calculateVariant(plan, variant, provider, false);
    })
  );
  const arrivalTimes = [plan.departureAt, ...selected.legs.map((leg) => leg.arrivalAt)];
  const weather = await weatherForTripStops(plan.stops, arrivalTimes);
  return {
    plan,
    selectedVariant: plan.variant,
    variants,
    weather,
    generatedAt: new Date().toISOString()
  };
}
