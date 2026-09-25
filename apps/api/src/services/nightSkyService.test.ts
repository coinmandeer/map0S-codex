import test from "node:test";
import assert from "node:assert/strict";
import { astronomyAt } from "./nightSkyService.js";
test("Málaga astronomy uses the observing timezone and a night crossing midnight", () => {
  const result = astronomyAt(-4.4214, 36.7213, new Date("2026-09-23T21:00:00Z"), "Europe/Madrid");
  assert.match(result.localTime, /23:00/);
  assert.ok(result.nightStart && result.nightEnd);
  assert.ok(Date.parse(result.nightEnd!) > Date.parse(result.nightStart!));
  assert.ok(result.moonAltitudeDeg >= -90 && result.moonAltitudeDeg <= 90);
  assert.ok(result.moonIlluminatedFraction >= 0 && result.moonIlluminatedFraction <= 1);
});
test("polar summer does not invent an astronomical night", () => {
  const result = astronomyAt(18.9553, 69.6492, new Date("2026-06-21T12:00:00Z"), "Europe/Oslo");
  assert.equal(result.nightStart, null);
  assert.equal(result.nightEnd, null);
});

test("after midnight, astronomy refers to the ongoing night rather than the next evening", () => {
  const at = new Date("2026-09-24T01:00:00Z");
  const result = astronomyAt(-4.4214, 36.7213, at, "Europe/Madrid");
  assert.ok(Date.parse(result.nightStart!) < at.getTime());
  assert.ok(Date.parse(result.nightEnd!) > at.getTime());
});
