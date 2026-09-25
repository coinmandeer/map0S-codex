import assert from "node:assert/strict";
import { test } from "node:test";
import { mapOdhWebcams } from "./odhWebcams.js";
import { mapDigitrafficWebcams } from "./digitrafficWebcams.js";
const odh = {
  Id: "one",
  Active: true,
  Webcamurl: "https://example.org/camera",
  GpsInfo: [{ Gpstype: "position", Latitude: 46, Longitude: 11 }],
  LicenseInfo: { License: "CC0", ClosedData: false }
};
test("ODH preserves open metadata attribution, never inherits image rights", () => {
  const result = mapOdhWebcams([
    odh,
    { ...odh, Id: "unknown", LicenseInfo: { License: "", ClosedData: false } },
    { ...odh, Id: "closed", LicenseInfo: { License: "CC0", ClosedData: true } }
  ]);
  assert.equal(
    mapOdhWebcams([{ ...odh, GpsInfo: [{ Gpstype: "position", Latitude: 0, Longitude: 0 }] }])
      .invalid,
    1
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.unverifiedLicense, 2);
  assert.equal(result.features[0]?.properties.photo, undefined);
  assert.equal(result.features[0]?.properties.metadataLicense, "CC0");
});
const station = {
  geometry: { type: "Point", coordinates: [24, 60, 0] },
  properties: {
    id: "C01503",
    collectionStatus: "GATHERING",
    state: null,
    presets: [{ id: "C0150301", inCollection: true }]
  }
};
test("Fintraffic uses collecting station and preset, no invented image time", () => {
  const result = mapDigitrafficWebcams([
    station,
    { ...station, properties: { ...station.properties, id: "C01504", collectionStatus: "REMOVED" } }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.properties.website, "https://weathercam.digitraffic.fi/C0150301.jpg");
  assert.equal(result[0]?.properties.capturedAt, undefined);
  assert.equal(
    mapDigitrafficWebcams([
      {
        ...station,
        properties: { ...station.properties, presets: [{ id: "C0150301", inCollection: false }] }
      }
    ]).length,
    0
  );
});
