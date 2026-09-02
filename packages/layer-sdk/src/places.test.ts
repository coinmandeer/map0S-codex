import assert from "node:assert/strict";
import test from "node:test";
import {
  PLACE_SOURCES,
  RELEASED_PLACE_SOURCES,
  defaultPlaceSources,
  placeSourceRuntimeAllowed
} from "./places.js";

test("prototype catalog never filters a place source by its advisory rights record", () => {
  assert.deepEqual(
    RELEASED_PLACE_SOURCES.map(({ id }) => id),
    PLACE_SOURCES.map(({ id }) => id)
  );
  assert.ok(PLACE_SOURCES.every(placeSourceRuntimeAllowed));

  const defaults = defaultPlaceSources();
  assert.equal(defaults.wikipedia, true);
  assert.equal(defaults.park4night, true);
  assert.equal(defaults.overture, false, "local Overture import remains a technical dependency");
});
