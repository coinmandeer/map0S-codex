import test from "node:test";
import assert from "node:assert/strict";
import { nearestPanoramaxPicture, nearestStreetImage, streetImages } from "./panoramaService.js";
test("street view selects an actual nearby image, never a map center or distant capture", () => {
  const result = nearestStreetImage(
    [
      { id: "1", geometry: { coordinates: [14.44, 50.08] } },
      {
        id: "2",
        geometry: { coordinates: [14.42, 50.08] },
        computed_geometry: { coordinates: [14.4301, 50.08] },
        captured_at: 1700000000000,
        is_pano: true,
        compass_angle: 137.6,
        sequence: "seq-a"
      },
      { id: "3", geometry: { coordinates: [14.431, 50.08] } },
      { id: "bad-url", geometry: { coordinates: [14.43, 50.08] } }
    ],
    14.43,
    50.08
  );
  assert.equal(result?.imageId, "2");
  assert.equal(result?.distanceMeters, 7);
  assert.equal(result?.capturedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(result?.isPano, true);
  assert.equal(result?.compassAngle, 138);
  assert.equal(result?.sequence, "seq-a");
  assert.equal(
    nearestStreetImage([{ id: "5", geometry: { coordinates: [15, 51] } }], 14.43, 50.08),
    null
  );
  assert.equal(
    nearestStreetImage([{ id: "6", geometry: { coordinates: [NaN, 50] } }], 14.43, 50.08),
    null
  );
});

test("the image list is ordered by distance and keeps a non-panorama out of the pano set", () => {
  const images = streetImages(
    [
      { id: "10", geometry: { coordinates: [14.432, 50.08] } },
      { id: "11", geometry: { coordinates: [14.4305, 50.08] }, is_pano: true }
    ],
    14.43,
    50.08
  );
  assert.deepEqual(
    images.map((image) => image.imageId),
    ["11", "10"]
  );
  assert.equal(images.find((image) => image.imageId === "10")?.isPano, false);
  assert.deepEqual(
    images.filter((image) => image.isPano).map((image) => image.imageId),
    ["11"]
  );
});

test("Panoramax picks the nearest ready picture and ignores processing or distant ones", () => {
  const picture = nearestPanoramaxPicture(
    [
      {
        id: "far",
        geometry: { coordinates: [15, 51] },
        properties: { "geovisio:status": "ready" }
      },
      {
        id: "processing",
        collection: "c1",
        geometry: { coordinates: [14.4301, 50.08] },
        properties: { "geovisio:status": "processing" }
      },
      {
        id: "ready",
        collection: "c1",
        geometry: { coordinates: [14.4301, 50.08] },
        properties: {
          "geovisio:status": "ready",
          datetime: "2025-06-26T09:38:45Z",
          "view:azimuth": 314.6
        },
        assets: { thumb: { href: "https://example.org/thumb.jpg" } }
      }
    ],
    14.43,
    50.08
  );
  assert.ok(picture);
  assert.equal(picture!.imageId, "ready");
  assert.equal(picture!.isPano, true);
  assert.equal(picture!.compassAngle, 315);
  assert.equal(picture!.capturedAt, "2025-06-26T09:38:45Z");
  assert.equal(picture!.thumbnailUrl, "https://example.org/thumb.jpg");
  assert.match(picture!.viewerUrl, /collections\/c1\/items\/ready/);
});

test("Panoramax returns nothing rather than a bad picture", () => {
  assert.equal(nearestPanoramaxPicture([], 14.43, 50.08), null);
  assert.equal(
    nearestPanoramaxPicture(
      [
        {
          id: "bad",
          geometry: { coordinates: [NaN, 50] },
          properties: { "geovisio:status": "ready" }
        }
      ],
      14.43,
      50.08
    ),
    null
  );
});
