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
        assert.ok([1, 2].includes(mapping.alternativesSupported));
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
    alternativesSupported: 1,
    warnings: []
  });

  const noHighways = resolvePlanRoutingRequestV2("mapy", "car", "nohwy");
  assert.equal(noHighways.preferenceCapability, "fallback");
  assert.equal(noHighways.effectivePreference, "fast");
  assert.equal(noHighways.providerProfile, "car_fast_traffic");
  assert.equal(noHighways.avoidTolls, true);
  assert.equal(noHighways.avoidMotorways, false);
  assert.match(noHighways.warnings.join(" "), /negarantuje vynechání dálnic/);
});

test("an adventure on foot or by bike is a BRouter request, not a renamed fast route", () => {
  for (const provider of ["osm", "mapy", "memory"] as const) {
    const walking = resolvePlanRoutingRequestV2(provider, "foot", "adventure");
    assert.equal(walking.providerProfile, "trekking");
    assert.equal(walking.adventureRouter, "brouter");
    assert.equal(walking.effectivePreference, "adventure");
    assert.equal(walking.preferenceCapability, "native");
    assert.equal(walking.alternativesSupported, 2, "BRouter answers with variants of its own");
    assert.deepEqual(walking.warnings, []);
    assert.equal(resolvePlanRoutingRequestV2(provider, "bike", "adventure").providerProfile, "mtb");
  }
  // A camper has nothing to gain from a trekking profile, so it keeps the honest fallback.
  const camper = resolvePlanRoutingRequestV2("osm", "camper", "adventure");
  assert.equal(camper.adventureRouter, undefined);
  assert.equal(camper.preferenceCapability, "fallback");
});

test("Mapy.com is reported as a single-variant router", () => {
  assert.equal(resolvePlanRoutingRequestV2("mapy", "car", "fast").alternativesSupported, 1);
  assert.equal(resolvePlanRoutingRequestV2("osm", "car", "fast").alternativesSupported, 2);
});

test("makes OSM and vehicle-category fallbacks explicit", () => {
  for (const preference of ["short", "nohwy"] as const) {
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
