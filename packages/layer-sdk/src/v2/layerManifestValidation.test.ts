import assert from "node:assert/strict";
import { describe, it } from "node:test";
import baseManifest from "./fixtures/user-layer-manifest.json" with { type: "json" };
import negativeCorpus from "./fixtures/layer-manifest-negative-corpus.json" with { type: "json" };
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_LAYER_SDK_VERSION,
  validateLayerContractV2,
  validateLayerManifestV2,
  type LayerHostCompatibilityV2,
  type LayerManifestV2,
  type LayerManifestValidationIssueCodeV2
} from "./index.js";

interface NegativeCase {
  id: string;
  expectedCode: LayerManifestValidationIssueCodeV2;
  override: Record<string, unknown>;
  host?: { availableCapabilities?: string[] };
}

function manifestFor(testCase: NegativeCase): LayerManifestV2 {
  return { ...structuredClone(baseManifest), ...testCase.override } as LayerManifestV2;
}

describe("the production layer-manifest validator", () => {
  it("keeps package, scaffold and host compatibility constants aligned", () => {
    assert.equal(MAPOS_LAYER_SDK_RANGE, `^${MAPOS_LAYER_SDK_VERSION}`);
    assert.match(MAPOS_HOST_RUNTIME_VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(validateLayerManifestV2(baseManifest).valid, true);
  });

  for (const entry of negativeCorpus as NegativeCase[]) {
    it(`rejects ${entry.id} through the exported validator and contract runner`, () => {
      const manifest = manifestFor(entry);
      const host: LayerHostCompatibilityV2 = entry.host ?? {};
      const validation = validateLayerManifestV2(manifest, host);
      assert.equal(validation.valid, false, JSON.stringify(validation));
      const issue = validation.issues.find(({ code }) => code === entry.expectedCode);
      assert.ok(issue, `${entry.expectedCode}: ${JSON.stringify(validation.issues)}`);
      assert.ok(issue.message.length > 24, "compatibility errors must explain the next action");

      const report = validateLayerContractV2({
        manifest,
        host,
        trust: "untrusted",
        publication: true
      });
      assert.equal(report.compatible, false, JSON.stringify(report));
      assert.ok(
        report.checks.some(({ code }) => code === entry.expectedCode),
        `${entry.expectedCode}: ${JSON.stringify(report.checks)}`
      );
    });
  }

  it("reports every missing capability in one actionable issue", () => {
    const validation = validateLayerManifestV2(
      {
        ...baseManifest,
        requiresServerCapabilities: ["weather-pro", "routing-pro"]
      },
      { availableCapabilities: ["public-data"] }
    );
    const issue = validation.issues.find(({ code }) => code === "MISSING_HOST_CAPABILITIES");
    assert.deepEqual(issue?.details?.missingCapabilities, ["routing-pro", "weather-pro"]);
    assert.match(issue?.message ?? "", /routing-pro, weather-pro/);
  });

  it("returns a structured contract report for arbitrary JSON instead of throwing", () => {
    const report = validateLayerContractV2({
      manifest: {} as LayerManifestV2,
      trust: "untrusted",
      publication: true
    });
    assert.equal(report.compatible, false);
    assert.equal(report.layerId, "unknown");
    assert.ok(report.checks.some(({ code }) => code === "SCHEMA_INVALID"));
  });
});
