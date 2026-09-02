import { and, asc, eq, inArray, lte, sql as drizzleSql } from "drizzle-orm";
import type { LayerImportReportV2 } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { layerImportPreviews, layerImports, userLayers, userPins } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import type {
  LayerImportCommitInput,
  LayerImportPreviewRecord,
  LayerImportRepository
} from "./layerImportService.js";

function slug(name: string, layerId: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${base || "import"}-${layerId.slice(0, 8)}`;
}

function databaseCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : null;
}

export class PostgresLayerImportRepository implements LayerImportRepository {
  async savePreview(preview: LayerImportPreviewRecord, maxPendingPerOwner: number) {
    if (!Number.isSafeInteger(maxPendingPerOwner) || maxPendingPerOwner < 1) {
      throw new Error("maxPendingPerOwner must be positive");
    }
    await db.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`SELECT pg_advisory_xact_lock(hashtextextended(${`mapos:layer-preview:${preview.ownerId}`}, 0))`
      );
      const current = await transaction
        .select({ id: layerImportPreviews.id })
        .from(layerImportPreviews)
        .where(eq(layerImportPreviews.userId, preview.ownerId))
        .orderBy(asc(layerImportPreviews.createdAt), asc(layerImportPreviews.id))
        .limit(maxPendingPerOwner);
      const removeCount = Math.max(0, current.length - maxPendingPerOwner + 1);
      const removeIds = current.slice(0, removeCount).map((row) => row.id);
      if (removeIds.length) {
        await transaction
          .delete(layerImportPreviews)
          .where(inArray(layerImportPreviews.id, removeIds));
      }
      await transaction.insert(layerImportPreviews).values({
        id: preview.previewId,
        userId: preview.ownerId,
        packageDigest: preview.packageDigest,
        parsed: preview.parsed,
        createdAt: new Date(preview.createdAt),
        expiresAt: new Date(preview.expiresAt)
      });
    });
  }

  async findPreview(ownerId: string, previewId: string) {
    const [row] = await db
      .select()
      .from(layerImportPreviews)
      .where(and(eq(layerImportPreviews.id, previewId), eq(layerImportPreviews.userId, ownerId)))
      .limit(1);
    if (!row) return null;
    return {
      ownerId: row.userId,
      previewId: row.id,
      packageDigest: row.packageDigest,
      parsed: row.parsed,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString()
    };
  }

  async deletePreview(ownerId: string, previewId: string) {
    const deleted = await db
      .delete(layerImportPreviews)
      .where(and(eq(layerImportPreviews.id, previewId), eq(layerImportPreviews.userId, ownerId)))
      .returning({ id: layerImportPreviews.id });
    return deleted.length > 0;
  }

  async deleteExpiredPreviews(expiresBefore: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("cleanup limit must be between 1 and 1000");
    }
    const expired = await db
      .select({ id: layerImportPreviews.id })
      .from(layerImportPreviews)
      .where(lte(layerImportPreviews.expiresAt, new Date(expiresBefore)))
      .orderBy(asc(layerImportPreviews.expiresAt), asc(layerImportPreviews.id))
      .limit(limit);
    if (!expired.length) return 0;
    const deleted = await db
      .delete(layerImportPreviews)
      .where(
        inArray(
          layerImportPreviews.id,
          expired.map((row) => row.id)
        )
      )
      .returning({ id: layerImportPreviews.id });
    return deleted.length;
  }

  async findByPreview(ownerId: string, previewId: string) {
    const [row] = await db
      .select({ report: layerImports.report })
      .from(layerImports)
      .where(and(eq(layerImports.userId, ownerId), eq(layerImports.previewId, previewId)))
      .limit(1);
    return row?.report ?? null;
  }

  async commit(input: LayerImportCommitInput): Promise<LayerImportReportV2> {
    try {
      const outcome = await db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({ report: layerImports.report })
          .from(layerImports)
          .where(
            and(eq(layerImports.userId, input.ownerId), eq(layerImports.previewId, input.previewId))
          )
          .limit(1);
        if (existing) return { kind: "report" as const, report: existing.report };
        const [preview] = await transaction
          .select()
          .from(layerImportPreviews)
          .where(
            and(
              eq(layerImportPreviews.id, input.previewId),
              eq(layerImportPreviews.userId, input.ownerId)
            )
          )
          .limit(1)
          .for("update");
        if (!preview) {
          // A concurrent instance can consume the preview while this transaction waits for its
          // row lock. READ COMMITTED sees the resulting import on this fresh statement.
          const [committed] = await transaction
            .select({ report: layerImports.report })
            .from(layerImports)
            .where(
              and(
                eq(layerImports.userId, input.ownerId),
                eq(layerImports.previewId, input.previewId)
              )
            )
            .limit(1);
          return committed
            ? { kind: "report" as const, report: committed.report }
            : { kind: "missing" as const };
        }
        if (preview.expiresAt.getTime() <= Date.parse(input.committedAt)) {
          await transaction
            .delete(layerImportPreviews)
            .where(eq(layerImportPreviews.id, preview.id));
          return { kind: "expired" as const };
        }
        const parsed = preview.parsed;
        await transaction.insert(userLayers).values({
          id: input.layerId,
          userId: input.ownerId,
          name: parsed.preview.name,
          color: parsed.preview.color,
          slug: slug(parsed.preview.name, input.layerId),
          isPublic: input.visibility === "public" ? 1 : 0,
          createdAt: new Date(input.committedAt)
        });
        if (parsed.candidates.length) {
          await transaction.insert(userPins).values(
            parsed.candidates.map((candidate) => ({
              layerId: input.layerId,
              name: candidate.name,
              description: candidate.description,
              lng: candidate.lng,
              lat: candidate.lat,
              tags: candidate.tags,
              kind: candidate.kind,
              properties: {
                ...candidate.properties,
                maposSources: candidate.sources,
                maposProvenance: candidate.sources.map((source) => ({
                  source: source.providerId,
                  sourceRef: source.sourceId,
                  attribution: source.attribution,
                  license: source.license,
                  capturedAt: source.retrievedAt
                })),
                sourceFeatureId: candidate.sourceFeatureId
              }
            }))
          );
        }
        const report: LayerImportReportV2 = {
          schema: "mapos.layer-import-report",
          schemaVersion: "2.0.0",
          id: input.importId,
          previewId: input.previewId,
          layerId: input.layerId,
          status: "committed",
          format: parsed.preview.format,
          featureCount: parsed.candidates.length,
          packageDigest: preview.packageDigest,
          createdAt: input.committedAt,
          rolledBackAt: null
        };
        await transaction.insert(layerImports).values({
          id: input.importId,
          previewId: input.previewId,
          userId: input.ownerId,
          layerId: input.layerId,
          packageDigest: preview.packageDigest,
          format: parsed.preview.format,
          manifest: parsed.manifest,
          featureCount: parsed.candidates.length,
          status: "committed",
          report,
          createdAt: new Date(input.committedAt),
          rolledBackAt: null
        });
        await transaction.delete(layerImportPreviews).where(eq(layerImportPreviews.id, preview.id));
        return { kind: "report" as const, report };
      });
      if (outcome.kind === "missing") throw new ClientError("Import preview not found", 404);
      if (outcome.kind === "expired") throw new ClientError("Import preview expired", 410);
      return outcome.report;
    } catch (error) {
      if (databaseCode(error) === "23505") {
        const existing = await this.findByPreview(input.ownerId, input.previewId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async rollback(ownerId: string, importId: string, rolledBackAt: string) {
    return db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(layerImports)
        .where(and(eq(layerImports.id, importId), eq(layerImports.userId, ownerId)))
        .limit(1)
        .for("update");
      if (!row) throw new ClientError("Layer import not found", 404);
      if (row.status === "rolled-back") return row.report;
      if (row.layerId) {
        await transaction
          .delete(userLayers)
          .where(and(eq(userLayers.id, row.layerId), eq(userLayers.userId, ownerId)));
      }
      const report: LayerImportReportV2 = {
        ...row.report,
        status: "rolled-back",
        rolledBackAt
      };
      await transaction
        .update(layerImports)
        .set({
          layerId: null,
          status: "rolled-back",
          rolledBackAt: new Date(rolledBackAt),
          report
        })
        .where(and(eq(layerImports.id, importId), eq(layerImports.userId, ownerId)));
      return report;
    });
  }
}

export const postgresLayerImportRepository = new PostgresLayerImportRepository();
