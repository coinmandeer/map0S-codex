import assert from "node:assert/strict";
import test from "node:test";
import { geocodeNearParam } from "./nearBias";

test("a place search is biased to the region on screen, coarsely", () => {
  assert.equal(geocodeNearParam({ lng: 16.60796, lat: 49.19522, zoom: 13 }), "&near=16.61,49.20");
  assert.equal(geocodeNearParam({ lng: 16.6, lat: 49.2, zoom: 3 }), "", "continent view");
  assert.equal(geocodeNearParam({ lng: Number.NaN, lat: 49.2, zoom: 12 }), "");
  assert.equal(geocodeNearParam(null), "");
});
