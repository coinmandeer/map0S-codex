import assert from "node:assert/strict";
import test from "node:test";
import { trustedBoundaryFeature, type TrustedRegionBoundary } from "./regionService.js";

const region = {
  id: "test-region",
  name: "Test region",
  level: "kraj" as const,
  parent: "CZ",
  bbox: [13, 49, 14, 50] as [number, number, number, number]
};

const boundary: TrustedRegionBoundary = {
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [13.1, 49.1],
        [13.8, 49.2],
        [13.7, 49.8],
        [13.1, 49.1]
      ]
    ]
  },
  provenance: {
    sourceId: "licensed-boundaries",
    attribution: "Boundary source contributors",
    license: "ODbL-1.0",
    url: "https://example.test/boundaries",
    updatedAt: "2026-08-31"
  }
};

test("a bbox-only region is never converted into boundary geometry", () => {
  assert.equal(trustedBoundaryFeature(region), null);
});

test("a valid ingested polygon is exposed with its provenance", () => {
  const feature = trustedBoundaryFeature({ ...region, boundary });
  assert.equal(feature?.geometry, boundary.geometry);
  assert.equal(feature?.properties.boundaryLicense, "ODbL-1.0");
  assert.equal(feature?.properties.boundarySourceId, "licensed-boundaries");
});

test("unclosed geometry is rejected while rights metadata remains advisory", () => {
  const openRing = structuredClone(boundary);
  openRing.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [13.1, 49.1],
        [13.8, 49.2],
        [13.7, 49.8],
        [13.2, 49.2]
      ]
    ]
  };
  assert.equal(trustedBoundaryFeature({ ...region, boundary: openRing }), null);

  const noLicence = structuredClone(boundary);
  noLicence.provenance.license = "";
  assert.ok(trustedBoundaryFeature({ ...region, boundary: noLicence }));
});
