import { randomUUID } from "node:crypto";
import { isOverviewResult, type OverviewRequest, type OverviewResult } from "@mapos/layer-sdk";
import { sql } from "../../db/index.js";
export interface OverviewSnapshotRepository {
  remove(owner: string, id: string): Promise<boolean>;
  save(owner: string, recipe: OverviewRequest, result: OverviewResult): Promise<string>;
  list(owner: string): Promise<{ id: string; title: string; createdAt: string }[]>;
  get(
    owner: string,
    id: string
  ): Promise<{ recipe: OverviewRequest; result: OverviewResult } | null>;
}
export const postgresOverviewSnapshots: OverviewSnapshotRepository = {
  async remove(owner, id) {
    const rows =
      await sql`DELETE FROM ai_overview_snapshots WHERE id=${id} AND owner_user_id=${owner} RETURNING id`;
    return rows.length > 0;
  },
  async save(owner, recipe, result) {
    if (!isOverviewResult(result)) throw new Error("Invalid overview snapshot");
    // Preserve cited facts and references, not full fetched documents or provider API archives.
    const cited = new Set(
      result.sections.flatMap((section) => section.claims.flatMap((claim) => claim.evidenceIds))
    );
    result.mapRefs.forEach((ref) => ref.evidenceIds.forEach((id) => cited.add(id)));
    const snapshot = {
      ...result,
      sources: result.sources.filter(
        (source) => cited.has(source.id) && source.access === "public" && source.kind !== "document"
      )
    };
    if (!isOverviewResult(snapshot))
      throw new Error("Private content requires a new public synthesis");
    const id = randomUUID();
    await sql`INSERT INTO ai_overview_snapshots (id,owner_user_id,recipe,snapshot) VALUES (${id},${owner},${JSON.stringify(recipe)}::jsonb,${JSON.stringify(snapshot)}::jsonb)`;
    return id;
  },
  async list(owner) {
    const rows =
      await sql`SELECT id, snapshot->'sources'->0->>'label' AS title, created_at FROM ai_overview_snapshots WHERE owner_user_id=${owner} ORDER BY created_at DESC LIMIT 50`;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? "AI přehled"),
      createdAt: new Date(row.created_at).toISOString()
    }));
  },
  async get(owner, id) {
    const rows =
      await sql`SELECT recipe,snapshot FROM ai_overview_snapshots WHERE id=${id} AND owner_user_id=${owner} LIMIT 1`;
    if (!rows[0] || !isOverviewResult(rows[0].snapshot)) return null;
    return { recipe: rows[0].recipe as OverviewRequest, result: rows[0].snapshot };
  }
};
