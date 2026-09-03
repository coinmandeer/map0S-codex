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

  it("accepts an inline layer that says where each of its points came from", () => {
    const manifest = {
      ...structuredClone(baseManifest),
      id: "ai-inline-kempy",
      source: {
        type: "inline",
        inline: {
          generatedAt: "2026-09-01T12:00:00.000Z",
          features: [
            {
              id: "osm:node/1",
              title: "Kemp U Řeky",
              longitude: 13.379,
              latitude: 49.749,
              category: "stay.camp_site",
              sourceId: "osm:overpass"
            }
          ]
        }
      }
    } as unknown as LayerManifestV2;
    assert.equal(validateLayerManifestV2(manifest).valid, true);
  });

  it("refuses an inline layer that cannot be attributed or repeats an id", () => {
    const inline = {
      type: "inline",
      inline: {
        features: [
          {
            id: "same",
            title: "První",
            longitude: 13.3,
            latitude: 49.7,
            sourceId: "osm:overpass"
          },
          {
            id: "same",
            title: "Druhá",
            longitude: 13.4,
            latitude: 49.8,
            sourceId: "osm:overpass"
          }
        ]
      }
    };
    const duplicates = validateLayerManifestV2({
      ...structuredClone(baseManifest),
      source: inline
    } as unknown as LayerManifestV2);
    assert.equal(duplicates.valid, false);
    assert.ok(duplicates.issues.some((issue) => issue.path.endsWith("/id")));

    const unattributed = validateLayerManifestV2({
      ...structuredClone(baseManifest),
      attribution: [],
      source: inline
    } as unknown as LayerManifestV2);
    assert.equal(unattributed.valid, false);
    assert.ok(unattributed.issues.some((issue) => issue.path === "/attribution"));

    const withUpstream = validateLayerManifestV2({
      ...structuredClone(baseManifest),
      source: { ...inline, endpoint: "https://example.test/features" }
    } as unknown as LayerManifestV2);
    assert.equal(withUpstream.valid, false);
    assert.ok(withUpstream.issues.some((issue) => issue.path === "/source/endpoint"));
  });

  it("keeps an AI-made inline layer distinguishable from surveyed data", () => {
    const withProvenance = (provenance: unknown) =>
      validateLayerManifestV2({
        ...structuredClone(baseManifest),
        id: "ai-inline-provenance",
        source: {
          type: "inline",
          inline: {
            provenance,
            features: [
              {
                id: "osm:node/1",
                title: "Kemp U Řeky",
                longitude: 13.379,
                latitude: 49.749,
                sourceId: "osm:overpass"
              }
            ]
          }
        }
      } as unknown as LayerManifestV2);

    assert.equal(
      withProvenance({
        kind: "ai",
        model: "glm-5.3-flash",
        prompt: "kempy u vody",
        createdAt: "2026-09-01T12:00:00.000Z",
        sourceIds: ["osm:overpass"]
      }).valid,
      true
    );
    // An assistant layer that will not name its model cannot be told apart from surveyed data.
    const anonymous = withProvenance({
      kind: "ai",
      createdAt: "2026-09-01T12:00:00.000Z",
      sourceIds: ["osm:overpass"]
    });
    assert.equal(anonymous.valid, false);
    assert.ok(anonymous.issues.some((issue) => issue.path.endsWith("/provenance/model")));
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
