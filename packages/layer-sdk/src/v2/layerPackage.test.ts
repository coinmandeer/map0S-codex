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
