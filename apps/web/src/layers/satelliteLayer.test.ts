import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json2satrec, type SatRec } from "satellite.js";
import { groundTracks, loadSatelliteMath } from "./satelliteLayer.js";

await loadSatelliteMath();

/**
 * The ground track is the "reflexе" the reader sees: the path a satellite is about to fly. It is
 * computed with real SGP4 from a real ISS element set, so this is an end-to-end check that the
 * propagation we ship produces a plausible orbit rather than merely a value.
 */
const ISS_OMM = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-09-14T20:28:04.673568",
  MEAN_MOTION: 15.49117649,
  ECCENTRICITY: 0.00049229,
  INCLINATION: 51.6309,
  RA_OF_ASC_NODE: 216.3169,
  ARG_OF_PERICENTER: 141.7352,
  MEAN_ANOMALY: 218.3986,
  BSTAR: 0.0001197967,
  MEAN_MOTION_DOT: 6.182e-5,
  MEAN_MOTION_DDOT: 0,
  NORAD_CAT_ID: 25544
};

function iss(): SatRec {
  return json2satrec(ISS_OMM as never) as SatRec;
}

const identity = { id: "25544", name: "ISS (ZARYA)", layerId: "satellites", color: "#f59e0b" };

describe("satellite ground track", () => {
  it("draws a line of real positions over the window", () => {
    const from = new Date("2026-09-14T20:30:00Z");
    const to = new Date("2026-09-14T21:00:00Z");
    const tracks = groundTracks(iss(), from, to, identity, 120);
    assert.ok(tracks.length >= 1, "the ISS is in view and produces a track");
    const geometry = tracks[0]!.geometry;
    assert.equal(geometry.type, "LineString");
    if (geometry.type !== "LineString") return;
    assert.ok(geometry.coordinates.length >= 2);
    for (const [lng, lat] of geometry.coordinates) {
      assert.ok(Number.isFinite(lng) && lng >= -180 && lng <= 180, `lng ${lng} is on the globe`);
      assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90, `lat ${lat} is on the globe`);
    }
  });

  it("splits a track at the antimeridian instead of drawing across the whole map", () => {
    // A polar-ish orbit crosses ±180° within a full revolution; scanning a long window must
    // therefore produce more than one run, and no single run may jump the date line.
    const from = new Date("2026-09-14T20:30:00Z");
    const to = new Date("2026-09-14T22:00:00Z");
    const tracks = groundTracks(iss(), from, to, identity, 120);
    for (const track of tracks) {
      const geometry = track.geometry;
      if (geometry.type !== "LineString") continue;
      for (let index = 1; index < geometry.coordinates.length; index += 1) {
        const jump = Math.abs(
          geometry.coordinates[index]![0] - geometry.coordinates[index - 1]![0]
        );
        assert.ok(jump <= 180, `a track must not jump the date line (jump ${jump})`);
      }
    }
  });

  it("returns no track rather than a broken one when the window is too short", () => {
    const at = new Date("2026-09-14T20:30:00Z");
    assert.deepEqual(groundTracks(iss(), at, at, identity, 120), []);
  });
});
