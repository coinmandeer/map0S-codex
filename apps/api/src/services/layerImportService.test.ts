import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryPin, MemoryUserLayer } from "../db/memory.js";
import { MemoryLayerImportRepository } from "./layerImportMemoryRepository.js";
import { LayerImportService, __testing, type LayerImportRepository } from "./layerImportService.js";

const input = {
  filename: "places.geojson",
  document: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "place-1",
        geometry: { type: "Point", coordinates: [14.4, 50.1] },
        properties: { name: "One" }
      }
    ]
  }
};

function memoryStorage() {
  return { userLayers: [] as MemoryUserLayer[], pins: [] as MemoryPin[] };
}

function idFactory() {
  let id = 0;
  return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
}

function withFailedFirstCommit(
  delegate: MemoryLayerImportRepository
): LayerImportRepository & { commits(): number } {
  let commitAttempts = 0;
  return {
    savePreview: (preview, max) => delegate.savePreview(preview, max),
    findPreview: (ownerId, previewId) => delegate.findPreview(ownerId, previewId),
    deletePreview: (ownerId, previewId) => delegate.deletePreview(ownerId, previewId),
    deleteExpiredPreviews: (expiresBefore, limit) =>
      delegate.deleteExpiredPreviews(expiresBefore, limit),
    findByPreview: (ownerId, previewId) => delegate.findByPreview(ownerId, previewId),
    async commit(commit) {
      commitAttempts += 1;
      if (commitAttempts === 1) throw new Error("transaction rolled back");
      return delegate.commit(commit);
    },
    rollback: (ownerId, importId, rolledBackAt) =>
      delegate.rollback(ownerId, importId, rolledBackAt),
    commits: () => commitAttempts
  };
}

describe("durable layer import service", () => {
  it("keeps a durable preview after failure and consumes it after an idempotent retry", async () => {
    const durable = new MemoryLayerImportRepository(memoryStorage());
    const repository = withFailedFirstCommit(durable);
    const service = new LayerImportService(
      repository,
      () => new Date("2026-09-01T10:00:00.000Z"),
      idFactory()
    );

    const preview = await service.preview("owner-a", input);
    await assert.rejects(() => service.commit("owner-a", preview.previewId), /rolled back/);
    assert.ok(await durable.findPreview("owner-a", preview.previewId));

    const committed = await service.commit("owner-a", preview.previewId);
    const retried = await service.commit("owner-a", preview.previewId);
    assert.equal(committed.id, retried.id);
    assert.equal(repository.commits(), 2);
    assert.equal(await durable.findPreview("owner-a", preview.previewId), null);
  });

  it("shares preview and idempotent commit state across two service instances", async () => {
    const storage = memoryStorage();
    const repository = new MemoryLayerImportRepository(storage);
    const ids = idFactory();
    const now = () => new Date("2026-09-01T10:00:00.000Z");
    const firstNode = new LayerImportService(repository, now, ids);
    const secondNode = new LayerImportService(repository, now, ids);

    const preview = await firstNode.preview("owner-a", input);
    const remoteCommit = await secondNode.commit("owner-a", preview.previewId, "private");
    const retryOnFirst = await firstNode.commit("owner-a", preview.previewId, "private");

    assert.equal(retryOnFirst.id, remoteCommit.id);
    assert.equal(storage.userLayers.length, 1);
    assert.equal(storage.pins.length, 1);
    assert.equal(await repository.findPreview("owner-a", preview.previewId), null);
  });

  it("isolates owners, allows prototype public import and safely deletes expired previews", async () => {
    let nowMs = Date.parse("2026-09-01T10:00:00.000Z");
    const storage = memoryStorage();
    const repository = new MemoryLayerImportRepository(storage);
    const service = new LayerImportService(repository, () => new Date(nowMs), idFactory());

    const preview = await service.preview("owner-a", input);
    await assert.rejects(() => service.commit("owner-b", preview.previewId), /not found/);
    await service.commit("owner-a", preview.previewId, "public");
    assert.equal(storage.userLayers[0]?.isPublic, 1);

    const expiring = await service.preview("owner-a", input);

    nowMs += __testing.PREVIEW_TTL_MS + 1;
    await assert.rejects(() => service.commit("owner-a", expiring.previewId), /expired/);
    assert.equal(await repository.findPreview("owner-a", expiring.previewId), null);
    await assert.rejects(() => service.commit("owner-a", expiring.previewId), /not found/);
  });

  it("cleans expired previews in a bounded batch", async () => {
    let nowMs = Date.parse("2026-09-01T10:00:00.000Z");
    const repository = new MemoryLayerImportRepository(memoryStorage());
    const service = new LayerImportService(repository, () => new Date(nowMs), idFactory());
    const previews = await Promise.all([
      service.preview("owner-a", input),
      service.preview("owner-a", input),
      service.preview("owner-a", input)
    ]);
    nowMs += __testing.PREVIEW_TTL_MS + 1;

    assert.equal(await repository.deleteExpiredPreviews(new Date(nowMs).toISOString(), 2), 2);
    const remaining = await Promise.all(
      previews.map((preview) => repository.findPreview("owner-a", preview.previewId))
    );
    assert.equal(remaining.filter(Boolean).length, 1);
  });

  it("keeps the 5 MiB and 1000-feature parser limits at the durable boundary", async () => {
    const service = new LayerImportService(
      new MemoryLayerImportRepository(memoryStorage()),
      undefined,
      idFactory()
    );
    await assert.rejects(
      () =>
        service.preview("owner-a", {
          filename: "large.csv",
          content: "x".repeat(5 * 1024 * 1024 + 1)
        }),
      /5 MiB/
    );
    await assert.rejects(
      () =>
        service.preview("owner-a", {
          filename: "many.geojson",
          document: {
            type: "FeatureCollection",
            features: Array.from({ length: 1_001 }, (_, index) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [14.4, 50.1] },
              properties: { name: `Point ${index}` }
            }))
          }
        }),
      /more than 1000 features/
    );
  });

  it("produces a stable SHA-256 digest independent of object key order", () => {
    assert.equal(
      __testing.digest({ filename: "x.geojson", document: { a: 1, b: 2 } }),
      __testing.digest({ document: { b: 2, a: 1 }, filename: "x.geojson" })
    );
    assert.match(__testing.digest(input), /^[0-9a-f]{64}$/);
  });
});
