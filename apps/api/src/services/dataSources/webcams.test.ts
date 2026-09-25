import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebcamsSource, mapWebcams, webcamLink } from "./webcams.js";
const bbox: [number, number, number, number] = [14.3, 50, 14.5, 50.2];
const camera = {
  type: "node",
  id: 1,
  lon: 14.4,
  lat: 50.1,
  tags: { name: "Square", "contact:webcam": "https://example.org/camera" }
};
test("webcam catalogue accepts links, not credentials, IP cameras or local schemes", () => {
  assert.equal(webcamLink("https://example.org/camera"), "https://example.org/camera");
  for (const url of [
    "http://127.0.0.1",
    "http://[::1]",
    "http://192.168.1.1",
    "https://user:pass@example.org",
    "rtsp://example.org",
    "http://host.local",
    "javascript:alert(1)"
  ])
    assert.equal(webcamLink(url), null);
});
test("only explicitly published webcam links, no CCTV-only/private/indoor features or media downloads", () => {
  const result = mapWebcams(
    [
      camera,
      { ...camera, id: 2, tags: { man_made: "surveillance" } },
      { ...camera, id: 3, tags: { ...camera.tags, access: "private" } },
      { ...camera, id: 4, tags: { ...camera.tags, indoor: "yes" } }
    ],
    bbox
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0]?.properties.photo, undefined);
  assert.equal(result.features[0]?.properties.website, camera.tags["contact:webcam"]);
  assert.equal(
    mapWebcams(
      Array.from({ length: 301 }, () => camera),
      bbox
    ).status,
    "partial"
  );
});
test("local catalogue filters before cap and abort prevents loading", async () => {
  let calls = 0;
  const features = mapWebcams([camera], bbox).features;
  const source = createWebcamsSource(async () => {
    calls++;
    return { revision: "fixture", builtAt: "2026-09-08", features };
  });
  const result = await source.load(bbox, {});
  assert.equal(Array.isArray(result) ? result.length : result.features.length, 1);
  await assert.rejects(source.load([-10, 30, 40, 70], {}));
  assert.equal(calls, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(source.load(bbox, {}, abort.signal), { name: "AbortError" });
  assert.equal(calls, 1);
  const outside = await source.load([15, 50, 15.1, 50.1], {});
  assert.equal(Array.isArray(outside) ? outside.length : outside.features.length, 0);
});

test("provider filtering happens before the viewport result cap", async () => {
  const base = mapWebcams([camera], bbox).features[0]!;
  const features = [
    ...Array.from({ length: 301 }, (_, i) => ({
      ...base,
      properties: { ...base.properties, id: `osm-${i}`, cameraProvider: "osm" }
    })),
    { ...base, properties: { ...base.properties, id: "finnish", cameraProvider: "digitraffic" } }
  ];
  const source = createWebcamsSource(async () => ({
    revision: "fixture",
    builtAt: "2026-09-08",
    features
  }));
  const result = await source.load(bbox, { provider: "digitraffic" });
  assert.ok(!Array.isArray(result));
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.features.map((f) => f.properties.id),
    ["finnish"]
  );
  await assert.rejects(source.load(bbox, { provider: "unknown" }), /Unknown camera source/);
});
