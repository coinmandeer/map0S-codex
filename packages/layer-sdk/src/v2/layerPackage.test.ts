import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import featureFixture from "./fixtures/osm-poi-feature.json" with { type: "json" };
import manifestFixture from "./fixtures/user-layer-manifest.json" with { type: "json" };
import {
  MAPOS_LAYER_PACKAGE_SCHEMA,
  LAYER_MANIFEST_V2_SCHEMA,
  LAYER_PACKAGE_V2_SCHEMA,
  MAPOS_FEATURE_V2_SCHEMA,
  assertMapOSLayerPackageV2,
  assertLayerImportPublishableV2,
  buildMapOSLayerPackageV2,
  parseLayerImportV2,
  type LayerManifestV2,
  type MapOSFeatureV2
} from "./index.js";

function publishableManifest(): LayerManifestV2 {
  return {
    ...(manifestFixture as LayerManifestV2),
    id: "osm-poi",
    source: { type: "static" },
    permissions: { ...manifestFixture.permissions, defaultVisibility: "public" },
    attribution: [{ label: "© OpenStreetMap contributors", license: "ODbL-1.0" }]
  };
}

describe("MapOS layer package v2", () => {
  it("round-trips a canonical package with provenance metadata", () => {
    const layerPackage = buildMapOSLayerPackageV2({
      id: "package-osm-poi",
      manifest: publishableManifest(),
      features: [featureFixture as unknown as MapOSFeatureV2],
      exportedAt: "2026-09-01T10:00:00.000Z"
    });
    assert.equal(layerPackage.schema, MAPOS_LAYER_PACKAGE_SCHEMA);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addSchema(LAYER_MANIFEST_V2_SCHEMA);
    ajv.addSchema(MAPOS_FEATURE_V2_SCHEMA);
    const validatePackage = ajv.compile(LAYER_PACKAGE_V2_SCHEMA);
    assert.equal(validatePackage(layerPackage), true, JSON.stringify(validatePackage.errors));
    const parsed = parseLayerImportV2({ filename: "osm.mapos.json", document: layerPackage });
    assert.equal(parsed.preview.format, "mapos-package");
    assert.equal(parsed.preview.featureCount, 1);
    assert.equal(parsed.preview.requestedVisibility, "public");
    assert.deepEqual(parsed.candidates[0]?.sources, featureFixture.sources);
    assert.doesNotThrow(() => assertLayerImportPublishableV2(parsed));
    assert.throws(
      () =>
        assertMapOSLayerPackageV2({
          ...layerPackage,
          media: [{ id: "escape", path: "../secret", mediaType: "image/png" }]
        }),
      /safe relative path/
    );
  });

  it("keeps raw GeoJSON private and previews duplicates without silently dropping them", () => {
    const point = {
      type: "Feature",
      id: "one",
      geometry: { type: "Point", coordinates: [14.42, 50.08] },
      properties: { name: "Same point" }
    };
    const parsed = parseLayerImportV2({
      filename: "points.geojson",
      document: { type: "FeatureCollection", features: [point, { ...point, id: "two" }] }
    });
    assert.equal(parsed.preview.requestedVisibility, "private");
    assert.equal(parsed.preview.featureCount, 2);
    assert.deepEqual(parsed.preview.duplicates[0]?.sourceFeatureIds, ["one", "two"]);
    assert.match(parsed.preview.warnings.join(" "), /privately/);
  });

  it("parses quoted CSV and rejects unsupported geometry without repair", () => {
    const parsed = parseLayerImportV2({
      filename: "places.csv",
      content:
        'name,lng,lat,source,sourceRef,attribution,license\n"Cafe, center",14.4,50.1,curator,row-1,Curator,CC-BY-4.0'
    });
    assert.equal(parsed.candidates[0]?.name, "Cafe, center");
    assert.equal(parsed.candidates[0]?.sources[0]?.rights, "open");
    assert.throws(
      () =>
        parseLayerImportV2({
          filename: "line.geojson",
          document: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [14, 50],
                    [15, 51]
                  ]
                },
                properties: {}
              }
            ]
          }
        }),
      /no silent repair/
    );
  });

  it("accepts legacy public packages with advisory source metadata", () => {
    const legacy = {
      schema: "mapos.user-layer-package",
      schemaVersion: "2.0.0",
      exportedAt: "2026-09-01T10:00:00Z",
      manifest: { ...manifestFixture, permissions: { defaultVisibility: "public" } },
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "legacy-1",
            geometry: { type: "Point", coordinates: [14.4, 50.1] },
            properties: {
              name: "Legacy",
              maposProvenance: [{ source: "unknown", sourceRef: "1" }]
            }
          }
        ]
      }
    };
    const parsed = parseLayerImportV2({ filename: "legacy.json", document: legacy });
    assert.equal(parsed.preview.format, "mapos-package");
    assert.deepEqual(parsed.preview.publicationErrors, []);
    assert.ok(parsed.preview.warnings.some((warning) => warning.includes("advisory")));
    assert.doesNotThrow(() => assertLayerImportPublishableV2(parsed));
  });

  it("accepts package source records without advisory attribution or rights", () => {
    const layerPackage = buildMapOSLayerPackageV2({
      id: "package-advisory-source",
      manifest: { ...publishableManifest(), attribution: [] },
      features: [featureFixture as unknown as MapOSFeatureV2],
      exportedAt: "2026-09-01T10:00:00.000Z",
      sources: [
        {
          providerId: "prototype-provider",
          sourceId: "source-1",
          retrievedAt: "2026-09-01T09:00:00.000Z",
          confidence: 0.5
        }
      ]
    });
    assert.doesNotThrow(() => assertMapOSLayerPackageV2(layerPackage));
  });

  it("rejects prototype keys and oversized batches", () => {
    const unsafe = JSON.parse(
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[14,50]},"properties":{"__proto__":{"admin":true}}}]}'
    );
    assert.throws(
      () => parseLayerImportV2({ filename: "unsafe.geojson", document: unsafe }),
      /unsafe property/
    );
    assert.throws(
      () => parseLayerImportV2({ filename: "large.csv", content: "x".repeat(5 * 1024 * 1024 + 1) }),
      /5 MiB/
    );
  });
});

describe("GPX import", () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin">
  <wpt lat="50.0880" lon="14.4208">
    <ele>202</ele>
    <time>2026-05-01T08:00:00Z</time>
    <name>Start &amp; parking</name>
    <desc>U kostela</desc>
  </wpt>
  <trk>
    <name>Ranní kolo</name>
    <desc>Podél řeky</desc>
    <trkseg>
      <trkpt lat="50.0880" lon="14.4208"><ele>202</ele></trkpt>
      <trkpt lat="50.0900" lon="14.4300"><ele>205</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="50.1000" lon="14.4400"><ele>210</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

  it("reads waypoints as places and a track as a route carrying its line", () => {
    const parsed = parseLayerImportV2({ filename: "activity.gpx", content: gpx });
    assert.equal(parsed.preview.format, "gpx");
    assert.equal(parsed.preview.name, "activity");
    assert.equal(parsed.candidates.length, 2);

    const [waypoint, track] = parsed.candidates;
    assert.equal(waypoint!.kind, "place");
    assert.equal(waypoint!.name, "Start & parking", "XML entities are decoded");
    assert.equal(waypoint!.description, "U kostela");
    assert.deepEqual([waypoint!.lng, waypoint!.lat], [14.4208, 50.088]);
    assert.equal(waypoint!.properties.elevationM, 202);
    assert.equal(waypoint!.properties.recordedAt, "2026-05-01T08:00:00Z");
    assert.equal(waypoint!.path, undefined);

    assert.equal(track!.kind, "route");
    assert.equal(track!.name, "Ranní kolo", "the track name wins over any point inside it");
    assert.equal(track!.description, "Podél řeky");
    assert.deepEqual(
      track!.path,
      [
        [14.4208, 50.088],
        [14.43, 50.09],
        [14.44, 50.1]
      ],
      "segments of one track join into a single line"
    );
    assert.deepEqual([track!.lng, track!.lat], [14.4208, 50.088], "anchored at its start");
    assert.equal(typeof track!.properties.distanceKm, "number");
  });

  it("keeps the preview light by dropping paths from the sample", () => {
    const parsed = parseLayerImportV2({ filename: "activity.gpx", content: gpx });
    assert.ok(parsed.preview.sample.every((candidate) => candidate.path === undefined));
    assert.equal(parsed.preview.sample.at(-1)?.properties.pointCount, 3);
  });

  it("recognises a GPX that arrived under the wrong name", () => {
    // A file copied off a watch or out of a share sheet often keeps a generic name.
    const parsed = parseLayerImportV2({ filename: "download", content: gpx });
    assert.equal(parsed.preview.format, "gpx");
  });

  it("simplifies a dense track without moving the line, and says so", () => {
    // A straight run of 6000 fixes with sub-metre jitter: RDP should collapse it to its ends.
    const points = Array.from(
      { length: 6_000 },
      (_entry, index) => `<trkpt lat="${50 + index * 1e-6}" lon="${14 + index * 1e-6}"></trkpt>`
    ).join("");
    const parsed = parseLayerImportV2({
      filename: "dense.gpx",
      content: `<gpx version="1.1"><trk><name>Dense</name><trkseg>${points}</trkseg></trk></gpx>`
    });
    const track = parsed.candidates[0]!;
    assert.ok(track.path!.length < 2_000, "the stored path is bounded");
    assert.deepEqual(track.path![0], [14, 50], "the start is kept exactly");
    assert.ok(
      parsed.preview.warnings.some((warning) => warning.includes("zjednodušena")),
      "the user is told the track was simplified"
    );
  });

  it("refuses a route it cannot draw and content that is not GPX", () => {
    const single = `<gpx version="1.1"><trk><name>One fix</name><trkseg>
      <trkpt lat="50" lon="14"></trkpt></trkseg></trk></gpx>`;
    // A one-point track is not a line; importing it as a route would draw nothing.
    assert.equal(parseLayerImportV2({ filename: "one.gpx", content: single }).candidates.length, 0);
    assert.throws(
      () => parseLayerImportV2({ filename: "notes.gpx", content: "<kml></kml>" }),
      /<gpx> root element/
    );
    assert.throws(
      () => parseLayerImportV2({ filename: "watch.gpx", document: { type: "FeatureCollection" } }),
      /GPX import requires content/
    );
  });

  it("cannot be published, because a recording carries no licence to claim", () => {
    const parsed = parseLayerImportV2({ filename: "activity.gpx", content: gpx });
    assert.equal(parsed.preview.requestedVisibility, "private");
    assert.ok(parsed.candidates.every((candidate) => candidate.sources[0]!.rights === "unknown"));
  });
});
