import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import osmPoiFeature from "./fixtures/osm-poi-feature.json" with { type: "json" };
import userLayerManifest from "./fixtures/user-layer-manifest.json" with { type: "json" };
import taskRecord from "./fixtures/task-record.json" with { type: "json" };
import {
  LAYER_MANIFEST_V2_SCHEMA,
  MAPOS_FEATURE_V2_SCHEMA,
  TASK_RECORD_V2_SCHEMA,
  SchemaCompatibilityError,
  assertCompatibleSchema,
  assertLayerManifestV2,
  assertMapOSFeatureV2,
  assertTaskRecordV2,
  normalizeFeatureLimit
} from "./index.js";
import { featureV1ToV2 } from "../compat/featureV1ToV2.js";
import { featureV2ToV1 } from "../compat/featureV2ToV1.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFeature = ajv.compile(MAPOS_FEATURE_V2_SCHEMA);
const validateLayer = ajv.compile(LAYER_MANIFEST_V2_SCHEMA);
const validateTask = ajv.compile(TASK_RECORD_V2_SCHEMA);

describe("Layer SDK v2 contracts", () => {
  it("validates the canonical feature and layer fixtures against Draft 2020-12 schemas", () => {
    assert.equal(validateFeature(osmPoiFeature), true, JSON.stringify(validateFeature.errors));
    assert.equal(validateLayer(userLayerManifest), true, JSON.stringify(validateLayer.errors));
    assertMapOSFeatureV2(osmPoiFeature);
    assertLayerManifestV2(userLayerManifest);
  });

  it("validates the canonical task fixture against the attached Draft 2020-12 schema", () => {
    assert.equal(validateTask(taskRecord), true, JSON.stringify(validateTask.errors));
    assertTaskRecordV2(taskRecord);
  });

  it("rejects invalid task progress and terminal timestamps", () => {
    assert.throws(() => assertTaskRecordV2({ ...taskRecord, progress: 1.1 }), /progress/);
    assert.throws(
      () => assertTaskRecordV2({ ...taskRecord, finishedAt: "yesterday" }),
      /finishedAt/
    );
    assert.throws(
      () =>
        assertTaskRecordV2({
          ...taskRecord,
          requestKey: "user-123|13.1,49.7|private-filter"
        }),
      /requestKey/
    );
    assert.equal(
      validateTask({ ...taskRecord, requestKey: "user-123|13.1,49.7|private-filter" }),
      false
    );
    assert.throws(
      () =>
        assertTaskRecordV2({
          ...taskRecord,
          telemetry: { ...taskRecord.telemetry, privateQuery: "secret" }
        }),
      /telemetry\.privateQuery/
    );
    assert.equal(
      validateTask({
        ...taskRecord,
        telemetry: { ...taskRecord.telemetry, privateQuery: "secret" }
      }),
      false
    );
  });

  it("accepts optional routing diagnostics and rejects unsafe correlation dimensions", () => {
    const routingTask = {
      ...taskRecord,
      type: "routing",
      telemetry: {
        durationMs: 125,
        aborted: false,
        cache: "mixed",
        providerId: "osm",
        eligibleSegments: 3,
        providerCalls: 2,
        cacheHits: 1,
        maxConcurrency: 2,
        failedSegments: 0
      },
      correlation: {
        requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285",
        providerId: "osm"
      }
    };
    assert.equal(validateTask(routingTask), true, JSON.stringify(validateTask.errors));
    assertTaskRecordV2(routingTask);

    assert.throws(
      () =>
        assertTaskRecordV2({
          ...routingTask,
          correlation: {
            ...routingTask.correlation,
            requestId: "https://private.test/?lat=50"
          }
        }),
      /correlation.requestId/
    );
    assert.throws(
      () =>
        assertTaskRecordV2({
          ...routingTask,
          telemetry: { ...routingTask.telemetry, providerCalls: -1 }
        }),
      /providerCalls/
    );
    assert.throws(
      () =>
        assertTaskRecordV2({
          ...routingTask,
          correlation: { ...routingTask.correlation, rawUrl: "https://private.test" }
        }),
      /correlation.rawUrl/
    );
  });

  it("rejects an unknown schema major with a structured compatibility error", () => {
    assert.throws(
      () =>
        assertCompatibleSchema(
          { schema: "mapos.layer-manifest", schemaVersion: "3.0.0" },
          "mapos.layer-manifest"
        ),
      (error: unknown) =>
        error instanceof SchemaCompatibilityError &&
        error.code === "UNSUPPORTED_SCHEMA_MAJOR" &&
        error.details.supportedMajor === 2
    );
  });

  it("clamps hostile or malformed query limits to the 1..100 contract", () => {
    assert.equal(normalizeFeatureLimit(10_000), 100);
    assert.equal(normalizeFeatureLimit("0"), 1);
    assert.equal(normalizeFeatureLimit("25.9"), 25);
    assert.equal(normalizeFeatureLimit("not-a-number"), 100);
  });

  it("round-trips a legacy point through v2 without changing renderer fields", () => {
    const legacy = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [14.42, 50.08] as [number, number] },
      properties: {
        id: "usgs:test-1",
        name: "M2.1 — test",
        category: "earthquake",
        layerId: "earthquakes",
        magnitude: 2.1
      }
    };
    const v2 = featureV1ToV2(legacy, {
      providerId: "usgs",
      attribution: "USGS",
      retrievedAt: "2026-09-01T08:00:00.000Z",
      rights: "open",
      kind: "event"
    });
    assertMapOSFeatureV2(v2);
    assert.deepEqual(featureV2ToV1(v2), legacy);
  });
});
