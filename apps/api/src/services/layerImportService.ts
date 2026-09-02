import { createHash, randomUUID } from "node:crypto";
import {
  parseLayerImportV2,
  type LayerImportFormatV2,
  type LayerImportInputV2,
  type LayerImportReportV2,
  type LayerImportVisibilityV2,
  type LayerManifestV2,
  type ParsedLayerImportV2
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";

const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_PENDING_PREVIEWS_PER_OWNER = 20;
const PREVIEW_CLEANUP_BATCH = 100;

export interface LayerImportPreviewRecord {
  ownerId: string;
  previewId: string;
  packageDigest: string;
  parsed: ParsedLayerImportV2;
  createdAt: string;
  expiresAt: string;
}

export interface LayerImportCommitInput {
  ownerId: string;
  importId: string;
  previewId: string;
  layerId: string;
  visibility: LayerImportVisibilityV2;
  committedAt: string;
}

export interface LayerImportRepository {
  savePreview(preview: LayerImportPreviewRecord, maxPendingPerOwner: number): Promise<void>;
  findPreview(ownerId: string, previewId: string): Promise<LayerImportPreviewRecord | null>;
  deletePreview(ownerId: string, previewId: string): Promise<boolean>;
  deleteExpiredPreviews(expiresBefore: string, limit: number): Promise<number>;
  findByPreview(ownerId: string, previewId: string): Promise<LayerImportReportV2 | null>;
  commit(input: LayerImportCommitInput): Promise<LayerImportReportV2>;
  rollback(ownerId: string, importId: string, rolledBackAt: string): Promise<LayerImportReportV2>;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError("Import data is nested too deeply");
  if (Array.isArray(value))
    return `[${value.map((entry) => canonical(entry, depth + 1)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry, depth + 1)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(input: LayerImportInputV2): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

function cloneManifest(manifest: LayerManifestV2 | null): LayerManifestV2 | null {
  return manifest ? (structuredClone(manifest) as LayerManifestV2) : null;
}

function cloneParsed(parsed: ParsedLayerImportV2): ParsedLayerImportV2 {
  return {
    preview: structuredClone(parsed.preview),
    manifest: cloneManifest(parsed.manifest),
    candidates: structuredClone(parsed.candidates)
  };
}

export class LayerImportService {
  constructor(
    private readonly repository: LayerImportRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  async preview(ownerId: string, input: LayerImportInputV2) {
    const createdAt = this.now();
    let parsed: ParsedLayerImportV2;
    try {
      parsed = parseLayerImportV2(input, createdAt.toISOString());
    } catch (error) {
      throw new ClientError(error instanceof Error ? error.message : "Invalid layer import", 400);
    }
    const previewId = this.createId();
    let packageDigest: string;
    try {
      packageDigest = digest(input);
    } catch (error) {
      throw new ClientError(error instanceof Error ? error.message : "Invalid layer import", 400);
    }
    const expiresAtMs = createdAt.getTime() + PREVIEW_TTL_MS;
    // Cleanup is deliberately bounded. The repository enforces the per-owner cap atomically, so
    // multiple API instances cannot each create their own independent allowance.
    await this.repository.deleteExpiredPreviews(createdAt.toISOString(), PREVIEW_CLEANUP_BATCH);
    await this.repository.savePreview(
      {
        ownerId,
        previewId,
        packageDigest,
        parsed: cloneParsed(parsed),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString()
      },
      MAX_PENDING_PREVIEWS_PER_OWNER
    );
    return {
      previewId,
      packageDigest,
      expiresAt: new Date(expiresAtMs).toISOString(),
      preview: structuredClone(parsed.preview)
    };
  }

  async commit(
    ownerId: string,
    previewId: string,
    visibility?: LayerImportVisibilityV2
  ): Promise<LayerImportReportV2> {
    const durable = await this.repository.findByPreview(ownerId, previewId);
    if (durable) return durable;
    const preview = await this.repository.findPreview(ownerId, previewId);
    if (!preview) throw new ClientError("Import preview not found", 404);
    const committedAt = this.now();
    if (Date.parse(preview.expiresAt) <= committedAt.getTime()) {
      await this.repository.deletePreview(ownerId, previewId);
      throw new ClientError("Import preview expired", 410);
    }
    const selectedVisibility = visibility ?? preview.parsed.preview.requestedVisibility;
    return this.repository.commit({
      ownerId,
      importId: this.createId(),
      previewId,
      layerId: this.createId(),
      visibility: selectedVisibility,
      committedAt: committedAt.toISOString()
    });
  }

  rollback(ownerId: string, importId: string): Promise<LayerImportReportV2> {
    return this.repository.rollback(ownerId, importId, this.now().toISOString());
  }
}

export const __testing = {
  PREVIEW_TTL_MS,
  MAX_PENDING_PREVIEWS_PER_OWNER,
  PREVIEW_CLEANUP_BATCH,
  digest
};

export type { LayerImportFormatV2 };
