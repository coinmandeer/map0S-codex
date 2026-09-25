import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAND_COVER_CLASSES, landCoverYear } from "./landCoverLayer.js";

/**
 * The GIBS product publishes one edition per year. A malformed filter must fall back to a real
 * published year rather than building a tile URL for a date that returns an error.
 */
describe("land cover", () => {
  it("accepts a published year from a filter and clamps the rest", () => {
    assert.equal(landCoverYear({ year: "2015" }), 2015);
    assert.equal(landCoverYear({ year: ["2020", "2019"] }), 2020);
    assert.equal(landCoverYear({ year: "1900" }), 2024, "a too-early year falls back");
    assert.equal(landCoverYear({ year: "2999" }), 2024, "a future year falls back");
    assert.equal(landCoverYear({ year: "not-a-year" }), 2024);
    assert.equal(landCoverYear({}), 2024);
  });

  it("names the IGBP classes with the product's own colours", () => {
    assert.equal(LAND_COVER_CLASSES.length, 17);
    const water = LAND_COVER_CLASSES.find((entry) => entry.label.includes("Vodní"));
    assert.equal(water?.value, 17);
    assert.equal(water?.rgb, "134,202,227");
    assert.equal(
      LAND_COVER_CLASSES.find((entry) => entry.value === 13)?.label,
      "Zastavěné území a města"
    );
  });
});
