import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import {
  parseElements,
  satelliteCatalog,
  resetSatelliteCache,
  SATELLITE_CATEGORIES
} from "./satelliteService.js";

/**
 * The catalogue is CelesTrak GP as OMM JSON. These tests are about the two things that decide
 * whether a satellite can be drawn at all: the fields SGP4 needs are present and finite, and a
 * group CelesTrak cannot serve is reported as unavailable rather than as an empty group.
 */
const ISS = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-09-14T20:28:04.673568",
  MEAN_MOTION: 15.49117649,
  ECCENTRICITY: 0.00049229,
  INCLINATION: 51.6309,
  RA_OF_ASC_NODE: 216.3169,
  ARG_OF_PERICENTER: 141.7352,
  MEAN_ANOMALY: 218.3986,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58565,
  BSTAR: 0.0001197967,
  MEAN_MOTION_DOT: 6.182e-5,
  MEAN_MOTION_DDOT: 0
};

describe("satellite elements", () => {
  it("keeps the OMM fields SGP4 needs and normalises the epoch", () => {
    const parsed = parseElements(ISS, "stations");
    assert.ok(parsed);
    assert.equal(parsed!.id, "25544");
    assert.equal(parsed!.name, "ISS (ZARYA)");
    assert.equal(parsed!.category, "stations");
    assert.equal(parsed!.epoch, new Date(Date.parse(ISS.EPOCH)).toISOString());
    assert.equal(parsed!.meanMotion, ISS.MEAN_MOTION);
    assert.equal(parsed!.noradCatId, 25544);
  });

  it("drops a row SGP4 could not propagate instead of inventing numbers", () => {
    assert.equal(parseElements({ OBJECT_NAME: "Broken" }, "stations"), null);
    assert.equal(parseElements({ ...ISS, MEAN_MOTION: undefined }, "stations"), null);
    assert.equal(parseElements({ ...ISS, NORAD_CAT_ID: undefined }, "stations"), null);
    assert.equal(parseElements({ ...ISS, EPOCH: "not-a-date" }, "stations"), null);
    assert.equal(parseElements(null, "stations"), null);
    // A missing BSTAR/drag term is fine: SGP4 treats it as zero.
    const noDrag = parseElements(
      { ...ISS, BSTAR: undefined, MEAN_MOTION_DOT: undefined },
      "stations"
    );
    assert.equal(noDrag?.bstar, 0);
  });

  it("names every category the layer can filter by", () => {
    for (const id of ["stations", "weather", "gps", "science", "visual"]) {
      assert.ok(
        SATELLITE_CATEGORIES.some((category) => category.id === id),
        `${id} must exist`
      );
    }
    assert.ok(
      SATELLITE_CATEGORIES.some((category) => category.defaultOn),
      "at least one category is on by default"
    );
  });

  it("reports a category CelesTrak cannot serve as unavailable, not as zero satellites", async () => {
    resetSatelliteCache();
    // Force the transport to fail so an upstream outage is what the catalogue sees.
    __setUpstreamTestDependencies({
      resolveHost: async () => ["93.184.216.34"],
      request: async () => {
        throw new Error("network down");
      }
    });
    try {
      const catalog = await satelliteCatalog(["stations"]);
      assert.deepEqual(catalog.unavailable, ["stations"]);
      assert.equal(catalog.elements.length, 0);
      assert.equal(catalog.epoch, null);
      // The category list still reports every category, so the UI can show what exists.
      assert.ok(catalog.categories.some((category) => category.id === "stations"));
    } finally {
      __setUpstreamTestDependencies(null);
      __resetUpstreamCache();
      resetSatelliteCache();
    }
  });
});
