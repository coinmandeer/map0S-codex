import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePark4nightResponse } from "./park4nightService.js";

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
