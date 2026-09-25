import assert from "node:assert/strict";
import test from "node:test";
import { googleSelectionCoordinates } from "./googlePlaces";

test("Google selection exports validated coordinates without licensed place content", () => {
  const event = Object.assign(new Event("gmp-select"), {
    place: {
      id: "opaque-google-id",
      displayName: "Provider content",
      rating: 4.8,
      location: { lat: (): number => 36.72, lng: () => -4.42 }
    }
  });
  assert.deepEqual(googleSelectionCoordinates(event), { lat: 36.72, lng: -4.42 });
  for (const lat of [NaN, Infinity, 91]) {
    event.place.location.lat = () => lat;
    assert.equal(googleSelectionCoordinates(event), null);
  }
  assert.equal(googleSelectionCoordinates(new Event("gmp-select")), null);
});
