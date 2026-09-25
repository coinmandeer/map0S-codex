import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLayerManifestV2 } from "@mapos/layer-sdk";
import { answerBounds, answerResultManifest } from "./aiMapResults";
const place = {
  id: "1",
  layerId: "osm-poi",
  title: "Place",
  longitude: 14,
  latitude: 50,
  sourceId: "osm"
};
test("answer layer contains exact distinct source references and caps at 100", () => {
  const m = answerResultManifest(
    "Results",
    [
      place,
      place,
      { ...place, layerId: "other" },
      ...Array.from({ length: 120 }, (_, i) => ({ ...place, id: String(i + 2) }))
    ],
    [{ sourceId: "osm", label: "OSM" }]
  );
  assertLayerManifestV2(m);
  assert.equal(m.source.inline!.features.length, 100);
  assert.equal(m.source.inline!.features[1]!.sourceLayerId, "other");
  assert.equal(new Set(m.source.inline!.features.map((f) => f.id)).size, 100);
  assert.equal(m.source.type, "inline");
});
test("fit covers all points including a narrow dateline interval", () => {
  assert.deepEqual(
    answerBounds([
      { longitude: 14, latitude: 50 },
      { longitude: 16, latitude: 49 }
    ]),
    [14, 49, 16, 50]
  );
  assert.deepEqual(
    answerBounds([
      { longitude: 179, latitude: 1 },
      { longitude: -179, latitude: 2 }
    ]),
    [179, 1, 181, 2]
  );
  assert.deepEqual(answerBounds([place]), [14, 50, 14, 50]);
  assert.equal(answerBounds([]), null);
});

test("original detail id survives an opaque AI result id", () => {
  const m = answerResultManifest(
    "Test",
    [{ ...place, id: "poi:opaque", sourceFeatureId: "osm:way:123" }],
    [{ sourceId: "osm", label: "OSM" }]
  );
  assert.equal(m.source.inline!.features[0]!.sourceFeatureId, "osm:way:123");
});
