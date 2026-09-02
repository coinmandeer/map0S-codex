import type { LayerImportReportV2 } from "@mapos/layer-sdk";
import { memoryDb, type MemoryPin, type MemoryUserLayer } from "../db/memory.js";
import { ClientError } from "../utils/clientError.js";
import type {
  LayerImportCommitInput,
  LayerImportPreviewRecord,
  LayerImportRepository
} from "./layerImportService.js";

interface MemoryImportRow {
  ownerId: string;
  previewId: string;
  report: LayerImportReportV2;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryLayerImportRepository implements LayerImportRepository {
  readonly #imports: MemoryImportRow[] = [];
  readonly #previews = new Map<string, LayerImportPreviewRecord>();

  constructor(
    private readonly storage: { userLayers: MemoryUserLayer[]; pins: MemoryPin[] } = memoryDb
  ) {}

  async savePreview(preview: LayerImportPreviewRecord, maxPendingPerOwner: number) {
    if (!Number.isSafeInteger(maxPendingPerOwner) || maxPendingPerOwner < 1) {
      throw new Error("maxPendingPerOwner must be positive");
    }
    const ownerPreviews = [...this.#previews.values()]
      .filter((candidate) => candidate.ownerId === preview.ownerId)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.previewId.localeCompare(right.previewId)
      );
    const removeCount = Math.max(0, ownerPreviews.length - maxPendingPerOwner + 1);
    for (const candidate of ownerPreviews.slice(0, removeCount)) {
      this.#previews.delete(candidate.previewId);
    }
    this.#previews.set(preview.previewId, clone(preview));
  }

  async findPreview(ownerId: string, previewId: string) {
    const preview = this.#previews.get(previewId);
    return preview?.ownerId === ownerId ? clone(preview) : null;
  }

  async deletePreview(ownerId: string, previewId: string) {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.ownerId !== ownerId) return false;
    return this.#previews.delete(previewId);
  }

  async deleteExpiredPreviews(expiresBefore: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("cleanup limit must be positive");
    const cutoff = Date.parse(expiresBefore);
    const expired = [...this.#previews.values()]
      .filter((preview) => Date.parse(preview.expiresAt) <= cutoff)
      .sort(
        (left, right) =>
          Date.parse(left.expiresAt) - Date.parse(right.expiresAt) ||
          left.previewId.localeCompare(right.previewId)
      )
      .slice(0, limit);
    for (const preview of expired) this.#previews.delete(preview.previewId);
    return expired.length;
  }

  async findByPreview(ownerId: string, previewId: string) {
    const row = this.#imports.find(
      (candidate) => candidate.ownerId === ownerId && candidate.previewId === previewId
    );
    return row ? clone(row.report) : null;
  }

  async commit(input: LayerImportCommitInput): Promise<LayerImportReportV2> {
    const existing = this.#imports.find(
      (candidate) => candidate.ownerId === input.ownerId && candidate.previewId === input.previewId
    );
    if (existing) return clone(existing.report);
    const preview = this.#previews.get(input.previewId);
    if (!preview || preview.ownerId !== input.ownerId) {
      throw new ClientError("Import preview not found", 404);
    }
    if (Date.parse(preview.expiresAt) <= Date.parse(input.committedAt)) {
      this.#previews.delete(input.previewId);
      throw new ClientError("Import preview expired", 410);
    }
    const parsed = preview.parsed;
    const layer = {
      id: input.layerId,
      userId: input.ownerId,
      name: parsed.preview.name,
      color: parsed.preview.color,
      slug: `${
        parsed.preview.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50) || "import"
      }-${input.layerId.slice(0, 8)}`,
      isPublic: input.visibility === "public" ? 1 : 0
    };
    const pins = parsed.candidates.map((candidate, index) => ({
      id: `${input.layerId}:${index + 1}`,
      layerId: input.layerId,
      name: candidate.name,
      ...(candidate.description ? { description: candidate.description } : {}),
      lng: candidate.lng,
      lat: candidate.lat,
      tags: [...candidate.tags],
      kind: candidate.kind,
      properties: {
        ...candidate.properties,
        maposSources: clone(candidate.sources),
        maposProvenance: candidate.sources.map((source) => ({
          source: source.providerId,
          sourceRef: source.sourceId,
          attribution: source.attribution,
          license: source.license,
          capturedAt: source.retrievedAt
        })),
        sourceFeatureId: candidate.sourceFeatureId
      }
    }));
    const report: LayerImportReportV2 = {
      schema: "mapos.layer-import-report",
      schemaVersion: "2.0.0",
      id: input.importId,
      previewId: input.previewId,
      layerId: input.layerId,
      status: "committed",
      format: parsed.preview.format,
      featureCount: pins.length,
      packageDigest: preview.packageDigest,
      createdAt: input.committedAt,
      rolledBackAt: null
    };
    // Build every row first; these synchronous pushes are the memory adapter's atomic boundary.
    this.storage.userLayers.push(layer);
    this.storage.pins.push(...pins);
    this.#imports.push({ ownerId: input.ownerId, previewId: input.previewId, report });
    this.#previews.delete(input.previewId);
    return clone(report);
  }

  async rollback(ownerId: string, importId: string, rolledBackAt: string) {
    const row = this.#imports.find(
      (candidate) => candidate.ownerId === ownerId && candidate.report.id === importId
    );
    if (!row) throw new ClientError("Layer import not found", 404);
    if (row.report.status === "rolled-back") return clone(row.report);
    const layerId = row.report.layerId;
    if (layerId) {
      const layerIndex = this.storage.userLayers.findIndex(
        (layer) => layer.id === layerId && layer.userId === ownerId
      );
      if (layerIndex >= 0) this.storage.userLayers.splice(layerIndex, 1);
      for (let index = this.storage.pins.length - 1; index >= 0; index -= 1) {
        if (this.storage.pins[index]?.layerId === layerId) this.storage.pins.splice(index, 1);
      }
    }
    row.report = { ...row.report, status: "rolled-back", rolledBackAt };
    return clone(row.report);
  }
}
