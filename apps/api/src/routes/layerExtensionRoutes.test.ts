import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";
import { memoryDb } from "../db/memory.js";
import { ClientError } from "../utils/clientError.js";
import { MemoryLayerImportRepository } from "../services/layerImportMemoryRepository.js";
import { LayerImportService } from "../services/layerImportService.js";
import { registerLayerExtensionRoutes } from "./layerExtensionRoutes.js";

describe("shared layer extension routes", () => {
  const app = Fastify({ logger: false });
  const originalLayers = [...memoryDb.userLayers];
  const originalPins = [...memoryDb.pins];
  let id = 0;

  before(async () => {
    const repository = new MemoryLayerImportRepository();
    const importService = new LayerImportService(
      repository,
      () => new Date("2026-09-01T10:00:00.000Z"),
      () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`
    );
    registerLayerExtensionRoutes(app, {
      importService,
      sourceService: {
        async features() {
          throw new ClientError("Layer source not found", 404);
        }
      },
      resolveUserId(request) {
        const value = request.headers["x-test-user"];
        return typeof value === "string" ? value : null;
      }
    });
    await app.ready();
  });

  after(async () => {
    memoryDb.userLayers.splice(0, memoryDb.userLayers.length, ...originalLayers);
    memoryDb.pins.splice(0, memoryDb.pins.length, ...originalPins);
    await app.close();
  });

  it("requires an owner and rejects unknown preview fields", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v2/layer-imports/preview",
      payload: { filename: "empty.geojson", document: { type: "FeatureCollection", features: [] } }
    });
    assert.equal(unauthorized.statusCode, 401);
    const invalid = await app.inject({
      method: "POST",
      url: "/v2/layer-imports/preview",
      headers: { "x-test-user": "owner-a" },
      payload: {
        filename: "empty.geojson",
        document: { type: "FeatureCollection", features: [] },
        executable: "alert(1)"
      }
    });
    assert.equal(invalid.statusCode, 400);
  });

  it("previews, commits once, retries idempotently and rolls back the imported layer", async () => {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/v2/layer-imports/preview",
      headers: { "x-test-user": "owner-a" },
      payload: {
        filename: "points.geojson",
        document: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "one",
              geometry: { type: "Point", coordinates: [14.4, 50.1] },
              properties: { name: "One" }
            }
          ]
        }
      }
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = previewResponse.json();
    assert.equal(preview.preview.featureCount, 1);

    const commit = await app.inject({
      method: "POST",
      url: `/v2/layer-imports/${preview.previewId}/commit`,
      headers: { "x-test-user": "owner-a" },
      payload: { visibility: "private" }
    });
    assert.equal(commit.statusCode, 200, commit.body);
    const report = commit.json().report;
    assert.equal(report.status, "committed");
    assert.equal(
      memoryDb.userLayers.some((layer) => layer.id === report.layerId),
      true
    );
    assert.equal(memoryDb.pins.filter((pin) => pin.layerId === report.layerId).length, 1);
    assert.equal(
      Array.isArray(
        memoryDb.pins.find((pin) => pin.layerId === report.layerId)?.properties?.maposProvenance
      ),
      true
    );

    const retry = await app.inject({
      method: "POST",
      url: `/v2/layer-imports/${preview.previewId}/commit`,
      headers: { "x-test-user": "owner-a" },
      payload: {}
    });
    assert.equal(retry.json().report.id, report.id);

    const foreignRollback = await app.inject({
      method: "POST",
      url: `/v2/layer-imports/${report.id}/rollback`,
      headers: { "x-test-user": "owner-b" }
    });
    assert.equal(foreignRollback.statusCode, 404);
    const rollback = await app.inject({
      method: "POST",
      url: `/v2/layer-imports/${report.id}/rollback`,
      headers: { "x-test-user": "owner-a" }
    });
    assert.equal(rollback.statusCode, 200, rollback.body);
    assert.equal(rollback.json().report.status, "rolled-back");
    assert.equal(
      memoryDb.userLayers.some((layer) => layer.id === report.layerId),
      false
    );
    assert.equal(
      memoryDb.pins.some((pin) => pin.layerId === report.layerId),
      false
    );
  });

  it("keeps the source route fail-closed when no reviewed host is registered", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/layer-sources/partner.parks/features?bbox=14,49,15,51"
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { message: "Layer source not found" });
  });
});
