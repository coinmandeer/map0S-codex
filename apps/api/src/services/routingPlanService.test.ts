import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTripPlan } from "./routingPlanService.js";
import { parseRestrictionElements, parseRestrictionLimit } from "./tripRestrictionService.js";
import { estimateTripToll } from "./tripTollService.js";

const plan = normalizeTripPlan({
  name: "Praha",
  departureAt: "2026-09-01T08:00:00.000Z",
  variant: "fast",
  stops: [
    { id: "a", name: "Start", lng: 14.4, lat: 50.08, dwellMinutes: 0 },
    { id: "b", name: "Cíl", lng: 14.5, lat: 50.08, dwellMinutes: 0 }
  ],
  vehicle: { profile: "camper", heightM: 3.2, widthM: 2.3, weightT: 4.2 },
  visibility: "private"
});

test("trip plans accept 2–60 stops and clamp prototype vehicle inputs", () => {
  assert.equal(plan.stops.length, 2);
  assert.equal(plan.vehicle.profile, "camper");
  assert.throws(() => normalizeTripPlan({ ...plan, stops: [plan.stops[0]!] }), /2 až 60/);
  assert.equal(
    normalizeTripPlan({ ...plan, vehicle: { ...plan.vehicle, weightT: 999 } }).vehicle.weightT,
    60
  );
});

test("OSM restriction parsing marks limits exceeded by the vehicle", () => {
  assert.equal(parseRestrictionLimit("12'6\""), 3.81);
  const restrictions = parseRestrictionElements(
    [{ lat: 50.08, lon: 14.42, tags: { maxheight: "3.0 m", name: "Nízký most" } }],
    plan.vehicle
  );
  assert.equal(restrictions[0]?.kind, "maxheight");
  assert.equal(restrictions[0]?.exceedsVehicle, true);
});

test("the free toll estimate links likely Czech vignettes without claiming precision", () => {
  const toll = estimateTripToll(
    [
      [14.4, 50.08],
      [14.5, 50.08]
    ],
    { ...plan, vehicle: { ...plan.vehicle, profile: "car", weightT: 1.8 } }
  );
  assert.equal(toll.items[0]?.countryCode, "CZ");
  assert.match(toll.items[0]?.officialUrl ?? "", /edalnice/);
  assert.match(toll.disclaimer, /orientační/i);
});
