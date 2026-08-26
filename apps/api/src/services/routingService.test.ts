import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRoute } from "./routingService.js";

test("fetchRoute returns coordinates", async () => {
  const route = await fetchRoute("13.3775,49.7475", "13.382,49.7505", "foot");
  assert.ok(route.coordinates.length > 1);
  assert.ok(route.distanceM > 0);
  assert.ok(route.durationS > 0);
});
