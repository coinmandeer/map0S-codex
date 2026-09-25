import assert from "node:assert/strict";
import test from "node:test";
import { isBrouterProfile, parseBrouterTrack } from "./brouterService.js";

const TRACK = {
  features: [
    {
      properties: { "track-length": "12450", "total-time": "3120", "filtered ascend": "240" },
      geometry: {
        type: "LineString",
        coordinates: [
          [13.3775, 49.7475, 310],
          [13.39, 49.755, 348],
          [13.41, 49.765, 402]
        ]
      }
    }
  ]
};

test("a BRouter track becomes a segment with its length, time and elevation", () => {
  const route = parseBrouterTrack(TRACK);
  assert.ok(route);
  assert.equal(route.distanceM, 12_450);
  assert.equal(route.durationS, 3_120);
  assert.deepEqual(route.coordinates[0], [13.3775, 49.7475], "the third value is not a coordinate");
  assert.deepEqual(route.elevation, [310, 348, 402]);
});

test("a track without its length is not offered as a routed segment", () => {
  const withoutLength = {
    features: [{ properties: { "total-time": "3120" }, geometry: TRACK.features[0]!.geometry }]
  };
  assert.equal(parseBrouterTrack(withoutLength), null);
});

test("a payload that is not a line is refused rather than half-read", () => {
  assert.equal(parseBrouterTrack({ features: [] }), null);
  assert.equal(
    parseBrouterTrack({
      features: [
        {
          properties: { "track-length": "10", "total-time": "10" },
          geometry: { type: "Point", coordinates: [[13.3775, 49.7475]] }
        }
      ]
    }),
    null
  );
});

test("only the two profiles the preference maps to are BRouter profiles", () => {
  assert.ok(isBrouterProfile("trekking"));
  assert.ok(isBrouterProfile("mtb"));
  assert.ok(!isBrouterProfile("car_fast_traffic"));
});
