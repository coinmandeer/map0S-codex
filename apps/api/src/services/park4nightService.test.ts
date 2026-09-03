import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARK4NIGHT_CATEGORIES,
  PARK4NIGHT_SERVICES,
  parsePark4nightFilters,
  parsePark4nightResponse
} from "./park4nightService.js";

/**
 * The layer looked healthy for months while serving nothing: the endpoint wraps its places in an
 * object and the parser only accepted a bare array, so every response fell through to `[]`. These
 * pin the envelope down.
 */

const REAL_SHAPE = {
  api_infos: "This data is not public, STOP your parsing Thank you",
  status: "OK",
  lieux: [
    { id: "109709", latitude: "49.749908", longitude: "13.375517", titre: "2 sady 5. května" },
    { id: "109710", latitude: "49.75", longitude: "13.37", titre: "U řeky" }
  ]
};

describe("Park4Night response", () => {
  it("reads the places out of the envelope the service actually sends", () => {
    const places = parsePark4nightResponse(REAL_SHAPE);
    assert.equal(places.length, 2);
    assert.equal(places[0]!.id, "109709");
  });

  it("still accepts a bare array, in case they go back to one", () => {
    assert.equal(parsePark4nightResponse(REAL_SHAPE.lieux).length, 2);
  });

  it("treats anything else as empty rather than throwing at the caller", () => {
    for (const junk of [null, undefined, 42, "nope", {}, { lieux: "no" }]) {
      assert.deepEqual(parsePark4nightResponse(junk), []);
    }
  });
});

/**
 * The filters go into SQL, so what these check is the boundary: only values the layer can
 * actually produce reach the query. Everything else is dropped rather than passed through,
 * because the alternative is a hand-edited URL choosing what the `where` clause looks like.
 */
describe("Park4Night filters", () => {
  it("reads the comma-joined lists the layer's filters produce", () => {
    assert.deepEqual(
      parsePark4nightFilters({
        categories: "p4n-camping,p4n-aire",
        services: "water,electricity",
        minRating: "4"
      }),
      {
        categories: ["p4n-camping", "p4n-aire"],
        services: ["water", "electricity"],
        minRating: 4
      }
    );
  });

  it("drops values no category or service maps to", () => {
    const parsed = parsePark4nightFilters({
      categories: "p4n-camping,'; drop table --,p4n-nonsense",
      services: "water,helipad"
    });
    assert.deepEqual(parsed.categories, ["p4n-camping"]);
    assert.deepEqual(parsed.services, ["water"]);
  });

  it("omits a rating that would not narrow anything, and caps one that cannot exist", () => {
    // Zero is the slider's resting position: sending `rating >= 0` as a condition would only
    // exclude the places whose rating is unknown, which is the opposite of "no filter".
    assert.equal("minRating" in parsePark4nightFilters({ minRating: "0" }), false);
    assert.equal("minRating" in parsePark4nightFilters({}), false);
    assert.equal("minRating" in parsePark4nightFilters({ minRating: "nope" }), false);
    assert.equal(parsePark4nightFilters({ minRating: "9" }).minRating, 5);
  });

  it("agrees with the categories the code map can produce", () => {
    // The layer's filter options are written by hand in `builtins.ts`; if the two lists drift,
    // an option in the UI silently matches nothing.
    assert.deepEqual([...PARK4NIGHT_CATEGORIES].sort(), [
      "p4n-accommodation",
      "p4n-aire",
      "p4n-camping",
      "p4n-night",
      "p4n-other",
      "p4n-parking"
    ]);
    assert.deepEqual([...PARK4NIGHT_SERVICES].sort(), [
      "electricity",
      "shower",
      "toilets",
      "water",
      "wifi"
    ]);
  });
});
