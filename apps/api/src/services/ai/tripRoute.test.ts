import assert from "node:assert/strict";
import test from "node:test";
import { routeOverview, tripProfile } from "./tripRoute.js";
import { explicitTripDestination } from "./chatService.js";
test("route overview preserves endpoints and a narrow turn instead of truncating the journey", () => {
  const points: [number, number][] = Array.from({ length: 1200 }, (_, i) => [
    i / 10000,
    i === 643 ? 1 : 0
  ]);
  const overview = routeOverview(points, 20);
  assert.deepEqual(overview[0], points[0]);
  assert.deepEqual(overview.at(-1), points.at(-1));
  assert.ok(overview.some((p) => p[1] === 1));
  assert.ok(overview.length <= 20);
});
test("explicit destinations override viewport, relative locations do not", () => {
  assert.equal(explicitTripDestination("hezký výlet v okolí Malagy"), "Malagy");
  assert.equal(explicitTripDestination("výlet v okolí Malagy na kole"), "Malagy");
  assert.equal(explicitTripDestination("a walk around Málaga with kids"), "Málaga");
  assert.equal(explicitTripDestination("výlet v okolí mě"), null);
  assert.equal(explicitTripDestination("přidej kavárnu"), null);
  assert.equal(tripProfile("výlet"), "foot");
  assert.equal(tripProfile("výlet na kole"), "bike");
});
