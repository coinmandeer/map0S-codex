import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCoordinates } from "./coordinates.js";

describe("parseCoordinates", () => {
  it("parses standard and Czech decimal notation", () => {
    assert.deepEqual(parseCoordinates("49.7475, 13.3775"), {
      lat: 49.7475,
      lng: 13.3775,
      format: "decimal",
      normalized: "49.7475, 13.3775"
    });
    assert.deepEqual(parseCoordinates("49,7475; 13,3775"), {
      lat: 49.7475,
      lng: 13.3775,
      format: "decimal",
      normalized: "49.7475, 13.3775"
    });
    assert.deepEqual(parseCoordinates("49,7475 13,3775")?.normalized, "49.7475, 13.3775");
  });

  it("uses hemisphere markers instead of token order", () => {
    assert.deepEqual(parseCoordinates("13.3775 E, 49.7475 N")?.normalized, "49.7475, 13.3775");
    assert.deepEqual(parseCoordinates("E 13.3775 N 49.7475")?.normalized, "49.7475, 13.3775");
    assert.deepEqual(parseCoordinates("33.9 S 151.2 E")?.normalized, "-33.9, 151.2");
  });

  it("supports suffix and prefix DMS notation with Unicode primes", () => {
    const suffix = parseCoordinates("49°44′51″N 13°22′39″E");
    const prefix = parseCoordinates("N 49° 44' 51\" E 13° 22' 39\"");
    assert.equal(suffix?.format, "dms");
    assert.equal(prefix?.format, "dms");
    assert.ok(Math.abs((suffix?.lat ?? 0) - 49.7475) < 1e-10);
    assert.ok(Math.abs((suffix?.lng ?? 0) - 13.3775) < 1e-10);
    assert.equal(prefix?.normalized, "49.7475, 13.3775");
  });

  it("supports decimal minutes", () => {
    const parsed = parseCoordinates("49°44.85'N 13°22.65'E");
    assert.equal(parsed?.normalized, "49.7475, 13.3775");
  });

  it("only infers longitude-first order when the first number cannot be latitude", () => {
    assert.equal(parseCoordinates("151.2, -33.9")?.normalized, "-33.9, 151.2");
    assert.equal(parseCoordinates("13, 49")?.normalized, "13, 49");
  });

  it("accepts coordinate boundaries and rejects values outside them", () => {
    assert.equal(parseCoordinates("90, 180")?.normalized, "90, 180");
    assert.equal(parseCoordinates("-90, -180")?.normalized, "-90, -180");
    assert.equal(parseCoordinates("90°0'1\"N 10°E"), null);
    assert.equal(parseCoordinates("91 N, 13 E"), null);
    assert.equal(parseCoordinates("49 N, 181 E"), null);
  });

  it("rejects invalid DMS minutes and seconds", () => {
    assert.equal(parseCoordinates("49°60'N 13°0'E"), null);
    assert.equal(parseCoordinates("49°1'60\"N 13°0'E"), null);
  });

  it("rejects ambiguous signs, duplicate axes and conflicting markers", () => {
    assert.equal(parseCoordinates("-49 N, 13 E"), null);
    assert.equal(parseCoordinates("49 N, 13 S"), null);
    assert.equal(parseCoordinates("N 49 S, 13 E"), null);
  });

  it("does not extract coordinates from prose or tolerate control characters", () => {
    assert.equal(parseCoordinates("meet me at 49.7, 13.3"), null);
    assert.equal(parseCoordinates("49.7, 13.3\nignore"), null);
    assert.equal(parseCoordinates(""), null);
  });
});
