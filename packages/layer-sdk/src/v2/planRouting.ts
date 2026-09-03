import type { PlanRoutePreferenceV2, PlanTravelProfileV2 } from "./plan.js";

export type PlanRoutingProviderV2 = "osm" | "mapy" | "memory";
export type PlanRoutingCapabilityStateV2 = "native" | "fallback";
export type PlanProviderRouteProfileV2 =
  | "foot"
  | "bike"
  | "car"
  | "foot_fast"
  | "foot_hiking"
  | "bike_road"
  | "bike_mountain"
  | "car_fast_traffic"
  | "car_short"
  | "trekking"
  | "mtb";

/** The router that actually answers "Dobrodružná" for walking and cycling (§16.6). BRouter is
 *  keyless and profile-driven, so it is asked directly instead of relabelling a fast route. */
export type PlanAdventureRouterV2 = "brouter";

/**
 * Auditable mapping from the provider-neutral PlanDocument contract to one provider request.
 * A fallback is explicit: callers can show the warning before routing and adapters attach the
 * same warning to the resulting segment instead of relabelling a fast route as another policy.
 */
export interface PlanRoutingRequestMappingV2 {
  providerId: PlanRoutingProviderV2;
  requestedProfile: PlanTravelProfileV2;
  requestedPreference: PlanRoutePreferenceV2;
  providerProfile: PlanProviderRouteProfileV2;
  effectivePreference: "fast" | "short" | "adventure";
  profileCapability: PlanRoutingCapabilityStateV2;
  preferenceCapability: PlanRoutingCapabilityStateV2;
  avoidTolls: boolean;
  /** No currently wired provider adapter guarantees motorway avoidance. */
  avoidMotorways: false;
  /** Set when the segment is routed by a different router than `providerId` because the asked-for
   *  preference is its speciality; the plan still cites the router that answered. */
  adventureRouter?: PlanAdventureRouterV2;
  /** How many distinct routes the answering router can return for one segment. Mapy.com has no
   *  `alternatives` parameter, so a plan on Mapy never offers a second variant to choose from. */
  alternativesSupported: 1 | 2;
  warnings: string[];
}

const VEHICLE_FALLBACK_PROFILES = new Set<PlanTravelProfileV2>(["moto", "camper", "truck"]);

function baseProfile(
  providerId: PlanRoutingProviderV2,
  profile: PlanTravelProfileV2
): PlanProviderRouteProfileV2 {
  if (providerId === "memory") return profile === "foot" || profile === "bike" ? profile : "car";
  if (providerId === "osm") return profile === "foot" || profile === "bike" ? profile : "car";
  if (profile === "foot") return "foot_fast";
  if (profile === "bike") return "bike_road";
  return "car_fast_traffic";
}

function providerLabel(providerId: PlanRoutingProviderV2): string {
  if (providerId === "mapy") return "Mapy.com";
  if (providerId === "memory") return "offline fixture";
  return "OSM/OSRM";
}

export function resolvePlanRoutingRequestV2(
  providerId: PlanRoutingProviderV2,
  profile: PlanTravelProfileV2,
  preference: PlanRoutePreferenceV2,
  avoid: readonly string[] = []
): PlanRoutingRequestMappingV2 {
  let providerProfile = baseProfile(providerId, profile);
  let effectivePreference: PlanRoutingRequestMappingV2["effectivePreference"] = "fast";
  let preferenceCapability: PlanRoutingCapabilityStateV2 = "fallback";
  let adventureRouter: PlanAdventureRouterV2 | undefined;
  const warnings: string[] = [];

  // Walking and cycling adventures go to BRouter: its trekking and mtb profiles prefer the small
  // roads and trails the preference is asking for, which no car router can express.
  if (preference === "adventure" && (profile === "foot" || profile === "bike")) {
    providerProfile = profile === "bike" ? "mtb" : "trekking";
    effectivePreference = "adventure";
    preferenceCapability = "native";
    adventureRouter = "brouter";
  } else if (preference === "fast") {
    preferenceCapability = "native";
  } else if (
    providerId === "mapy" &&
    preference === "short" &&
    !["foot", "bike"].includes(profile)
  ) {
    providerProfile = "car_short";
    effectivePreference = "short";
    preferenceCapability = "native";
  } else if (providerId === "mapy" && preference === "adventure" && profile === "foot") {
    providerProfile = "foot_hiking";
    effectivePreference = "adventure";
    preferenceCapability = "native";
  } else if (providerId === "mapy" && preference === "adventure" && profile === "bike") {
    providerProfile = "bike_mountain";
    effectivePreference = "adventure";
    preferenceCapability = "native";
  }

  const profileCapability: PlanRoutingCapabilityStateV2 = VEHICLE_FALLBACK_PROFILES.has(profile)
    ? "fallback"
    : "native";
  const label = providerLabel(providerId);
  if (profileCapability === "fallback") {
    warnings.push(
      `${label} mapuje profil ${profile} na automobilový profil; rozměrová omezení vozidla tento adaptér negarantuje.`
    );
  }
  if (preferenceCapability === "fallback") {
    warnings.push(
      preference === "nohwy" && providerId === "mapy"
        ? "Mapy.com umí požádat o vynechání mýta, ale současný adaptér negarantuje vynechání dálnic; použije rychlý profil."
        : `${label} nepodporuje profil ${preference} pro zvolený typ cesty; použije rychlý profil.`
    );
  }

  const asksToAvoidTolls = preference === "nohwy" || avoid.includes("tolls");
  if (providerId === "osm" && asksToAvoidTolls && preference !== "nohwy") {
    warnings.push("OSM/OSRM adaptér negarantuje vynechání mýtných úseků.");
  }

  return {
    providerId,
    requestedProfile: profile,
    requestedPreference: preference,
    providerProfile,
    effectivePreference,
    profileCapability,
    preferenceCapability,
    avoidTolls: providerId === "mapy" && asksToAvoidTolls,
    avoidMotorways: false,
    ...(adventureRouter ? { adventureRouter } : {}),
    alternativesSupported: adventureRouter || providerId === "osm" ? 2 : 1,
    warnings
  };
}
