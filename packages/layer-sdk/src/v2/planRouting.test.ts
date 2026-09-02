import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePlanRoutingRequestV2,
  type PlanRoutePreferenceV2,
  type PlanTravelProfileV2
} from "../index.js";

const preferences: PlanRoutePreferenceV2[] = ["fast", "short", "nohwy", "adventure"];
const profiles: PlanTravelProfileV2[] = ["foot", "bike", "car", "moto", "camper", "truck"];

test("documents a finite request mapping for every vehicle and canonical preference", () => {
  for (const provider of ["osm", "mapy"] as const) {
    for (const profile of profiles) {
      for (const preference of preferences) {
        const mapping = resolvePlanRoutingRequestV2(provider, profile, preference);
        assert.equal(mapping.providerId, provider);
        assert.equal(mapping.requestedProfile, profile);
        assert.equal(mapping.requestedPreference, preference);
        assert.ok(mapping.providerProfile.length > 0);
        assert.ok(["native", "fallback"].includes(mapping.profileCapability));
        assert.ok(["native", "fallback"].includes(mapping.preferenceCapability));
        if (mapping.preferenceCapability === "fallback") assert.ok(mapping.warnings.length > 0);
      }
    }
  }
});

test("keeps native Mapy requests distinct and never relabels unsupported routes", () => {
  assert.deepEqual(resolvePlanRoutingRequestV2("mapy", "car", "short"), {
    providerId: "mapy",
    requestedProfile: "car",
    requestedPreference: "short",
    providerProfile: "car_short",
    effectivePreference: "short",
    profileCapability: "native",
    preferenceCapability: "native",
    avoidTolls: false,
    avoidMotorways: false,
    warnings: []
  });
  assert.equal(
    resolvePlanRoutingRequestV2("mapy", "foot", "adventure").providerProfile,
    "foot_hiking"
  );
  assert.equal(
    resolvePlanRoutingRequestV2("mapy", "bike", "adventure").providerProfile,
    "bike_mountain"
  );

  const noHighways = resolvePlanRoutingRequestV2("mapy", "car", "nohwy");
  assert.equal(noHighways.preferenceCapability, "fallback");
  assert.equal(noHighways.effectivePreference, "fast");
  assert.equal(noHighways.providerProfile, "car_fast_traffic");
  assert.equal(noHighways.avoidTolls, true);
  assert.equal(noHighways.avoidMotorways, false);
  assert.match(noHighways.warnings.join(" "), /negarantuje vynechání dálnic/);
});

test("makes OSM and vehicle-category fallbacks explicit", () => {
  for (const preference of ["short", "nohwy", "adventure"] as const) {
    const mapping = resolvePlanRoutingRequestV2("osm", "car", preference);
    assert.equal(mapping.providerProfile, "car");
    assert.equal(mapping.effectivePreference, "fast");
    assert.equal(mapping.preferenceCapability, "fallback");
    assert.ok(mapping.warnings.length > 0);
  }
  const camper = resolvePlanRoutingRequestV2("mapy", "camper", "fast");
  assert.equal(camper.providerProfile, "car_fast_traffic");
  assert.equal(camper.profileCapability, "fallback");
  assert.match(camper.warnings.join(" "), /rozměrová omezení/);
});
