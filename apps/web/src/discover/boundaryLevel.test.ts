import assert from "node:assert/strict";
import test from "node:test";
import { boundaryLevel, availableBoundaryLevel, showAreaBoundaries } from "./boundaryLevel";

test("Discover zoom uses hysteresis but supports jumps across multiple levels", () => {
  assert.equal(boundaryLevel(3), "country");
  assert.equal(boundaryLevel(4), "adm1");
  assert.equal(boundaryLevel(4.1, "country"), "country");
  assert.equal(boundaryLevel(4.25, "country"), "adm1");
  assert.equal(boundaryLevel(3.8, "adm1"), "adm1");
  assert.equal(boundaryLevel(3.7, "adm1"), "country");
  assert.equal(boundaryLevel(12, "country"), "lau");
  assert.equal(boundaryLevel(2, "lau"), "country");
});

test("missing city boundaries fall back honestly and never relabel NUTS as administration", () => {
  assert.equal(availableBoundaryLevel("lau", ["nuts3", "country", "adm1"]), "adm1");
  assert.equal(availableBoundaryLevel("adm1", ["nuts1", "nuts2"]), null);
});

test("boundary outlines disappear at the last area level or detailed zoom", () => {
  assert.equal(showAreaBoundaries(true, 11, "adm2"), true);
  assert.equal(showAreaBoundaries(true, 11, "lau"), false);
  assert.equal(showAreaBoundaries(true, 13.5, "adm2"), false);
  assert.equal(showAreaBoundaries(false, 8, "country"), false);
});
