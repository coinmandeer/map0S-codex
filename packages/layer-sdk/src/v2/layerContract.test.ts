import assert from "node:assert/strict";
import { describe, it } from "node:test";
import featureFixture from "./fixtures/osm-poi-feature.json" with { type: "json" };
import manifestFixture from "./fixtures/user-layer-manifest.json" with { type: "json" };
import {
  featureQueryResult,
  runLayerContractV2,
  validateLayerContractV2,
  validateLayerManifestV2,
  type FeatureQueryResultV2,
  type LayerManifestV2,
  type MapOSFeatureV2
} from "./index.js";

const manifest: LayerManifestV2 = {
  ...(manifestFixture as LayerManifestV2),
  id: "osm-poi",
  source: {
    type: "declarative-http",
    endpoint: "https://data.example.test/pois",
    method: "GET",
    requiresServerProxy: true,
    query: { bbox: "bbox", limit: "limit", category: "filter:category" },
    mapping: {
      itemsPath: "data.items",
      idPath: "id",
      titlePath: "name",
      categoryPath: "category",
      longitudePath: "position.lng",
      latitudePath: "position.lat"
    }
  },
  attribution: [{ label: "Open fixture", license: "CC0-1.0" }]
};

const fixture = featureQueryResult({
  features: [featureFixture as unknown as MapOSFeatureV2],
  requestedLimit: 20,
  sources: [{ providerId: "osm", state: "ready" }]
});

describe("public layer contract runner", () => {
  it("publishes the declarative boundary in the JSON schema", () => {
    assert.equal(validateLayerManifestV2(manifest).valid, true);
    assert.equal(
      validateLayerManifestV2({
        ...manifest,
        source: { ...manifest.source, responseAdapter: "execute-me" }
      }).valid,
      false
    );
  });

  it("validates an untrusted declarative fixture without executable runtime", () => {
    const report = validateLayerContractV2({
      manifest,
      fixture,
      trust: "untrusted",
      publication: true
    });
    assert.equal(report.compatible, true, JSON.stringify(report.checks));
    assert.ok(
      report.checks.some((check) => check.id === "secret-scan" && check.status === "passed")
    );
  });

  it("reports incomplete source-rights metadata as advisory without blocking the prototype", () => {
    const advisoryFixture = structuredClone(fixture);
    advisoryFixture.data.features[0]!.sources[0]!.rights = "unknown";
    const report = validateLayerContractV2({
      manifest: { ...manifest, attribution: [] },
      fixture: advisoryFixture,
      trust: "untrusted",
      publication: true
    });
    assert.equal(report.compatible, true, JSON.stringify(report.checks));
    assert.equal(
      report.checks.find((check) => check.id === "publication-metadata")?.status,
      "warning"
    );
    assert.equal(report.checks.find((check) => check.id === "source-rights")?.status, "warning");
  });

  it("rejects custom runtime and likely secrets for untrusted extensions", () => {
    const report = validateLayerContractV2({
      manifest: {
        ...manifest,
        source: { type: "custom-runtime", adapterId: "evil", authRef: "token" }
      } as LayerManifestV2 & { source: LayerManifestV2["source"] & { token?: string } },
      trust: "untrusted"
    });
    assert.equal(report.compatible, false);
    assert.equal(report.checks.find((check) => check.id === "trust-boundary")?.status, "failed");
  });

  it("runs deterministic and cancellation behavior against a local fixture adapter", async () => {
    const adapter = {
      async query(_query: unknown, signal: AbortSignal): Promise<FeatureQueryResultV2> {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return structuredClone(fixture);
      }
    };
    const report = await runLayerContractV2({ manifest, adapter, publication: true });
    assert.equal(report.compatible, true, JSON.stringify(report.checks));
    assert.equal(
      report.checks.find((check) => check.id === "deterministic-mapping")?.status,
      "passed"
    );
    assert.equal(report.checks.find((check) => check.id === "cancellation")?.status, "passed");
  });

  it("rejects credentialed or executable declarative source shapes", () => {
    const report = validateLayerContractV2({
      manifest: {
        ...manifest,
        source: {
          ...manifest.source,
          endpoint: "https://user:pass@example.test/pois",
          responseAdapter: "eval-provider"
        }
      }
    });
    assert.equal(report.compatible, false);
    assert.match(
      report.checks.find((check) => check.id === "manifest")?.message ?? "",
      /credential-free/
    );
  });
});
