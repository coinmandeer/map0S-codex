import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_VERSION,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import { inspectLayerImportHostCompatibility } from "./layerImportDashboard";

function manifest(overrides: Partial<LayerManifestV2> = {}): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    minimumRuntime: "19.0.0",
    id: "owner.fixture",
    name: "Owner fixture",
    description: "Offline compatibility fixture",
    category: "user",
    geometryKinds: ["Point"],
    renderer: { type: "symbols" },
    source: { type: "static" },
    queryPolicy: { strategy: "global", maxResultsPerViewport: 20 },
    attribution: [{ label: "Fixture owner", license: "CC0-1.0" }],
    capabilities: ["query", "detail"],
    ...overrides
  };
}

describe("owner layer compatibility inspection", () => {
  it("uses the canonical SDK validator and exposes declared and host versions", () => {
    const inspection = inspectLayerImportHostCompatibility(
      JSON.stringify({ manifest: manifest() }),
      "fixture.mapos.json"
    );
    assert.deepEqual(inspection.host, {
      sdkVersion: MAPOS_LAYER_SDK_VERSION,
      runtimeVersion: MAPOS_HOST_RUNTIME_VERSION,
      availableCapabilities: ["auth", "user-layers-v2"]
    });
    assert.deepEqual(inspection.declaration, {
      present: true,
      schema: "mapos.layer-manifest",
      schemaVersion: "2.0.0",
      sdkRange: "^2.0.0",
      minimumRuntime: "19.0.0",
      requiredCapabilities: []
    });
    assert.equal(inspection.report?.valid, true, JSON.stringify(inspection.report));
  });

  it("checks declared server capabilities against this owner-import host", () => {
    const inspection = inspectLayerImportHostCompatibility(
      JSON.stringify({ manifest: manifest({ requiresServerCapabilities: ["partner-proxy"] }) }),
      "partner.mapos.json"
    );
    assert.equal(inspection.report?.compatible, false);
    assert.ok(inspection.report?.issues.some(({ code }) => code === "MISSING_HOST_CAPABILITIES"));
  });

  it("reports an unmet minimum runtime with the SDK's structured issue code", () => {
    const inspection = inspectLayerImportHostCompatibility(
      JSON.stringify({ manifest: manifest({ minimumRuntime: "99.0.0" }) }),
      "future.mapos.json"
    );
    assert.equal(inspection.report?.compatible, false);
    assert.ok(inspection.report?.issues.some(({ code }) => code === "MINIMUM_RUNTIME_NOT_MET"));
  });

  it("marks GeoJSON and CSV as manifest-free without inventing compatibility", () => {
    const geojson = inspectLayerImportHostCompatibility(
      JSON.stringify({ type: "FeatureCollection", features: [] }),
      "points.geojson"
    );
    const csv = inspectLayerImportHostCompatibility("name,lng,lat", "points.csv");
    assert.equal(geojson.declaration.present, false);
    assert.equal(geojson.report, null);
    assert.equal(csv.declaration.present, false);
    assert.equal(csv.report, null);
  });
});
