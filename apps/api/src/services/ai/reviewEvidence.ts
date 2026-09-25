import { sql } from "../../db/index.js";
import type { EvidenceItem } from "@mapos/layer-sdk";
/** Public place reviews only. No author identity, private layer, comment or note is projected. */
export async function publicPlaceReviewEvidence(
  placeId: string,
  signal: AbortSignal
): Promise<EvidenceItem[]> {
  if (!/^osm:(node|way|relation):\d+$/.test(placeId)) return [];
  signal.throwIfAborted();
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '2500ms'`;
    return tx`SELECT id, body, rating, created_at, updated_at, count(*) OVER() AS available
      FROM social_reviews WHERE target_type='place' AND target_id=${placeId} AND body IS NOT NULL
      ORDER BY updated_at DESC, id DESC LIMIT 20`;
  });
  signal.throwIfAborted();
  if (!rows.length) return [];
  const available = Number(rows[0]!.available);
  return rows.map((row) => ({
    id: `review:${row.id}`,
    sourceRecordId: String(row.id),
    providerId: "mapos-reviews",
    label: "Návštěvnická recenze MapOS",
    relation: "same_entity",
    topic: "experience",
    kind: "report",
    access: "public",
    originGroup: `mapos-review:${row.id}`,
    text: `${String(row.body).slice(0, 1200)} (Hodnocení ${Number(row.rating)}/5; výběr ${rows.length} posledních textových recenzí z ${available} dostupných.)`,
    publishedAt: new Date(row.created_at).toISOString(),
    retrievedAt: new Date().toISOString(),
    cacheUntil: new Date(Date.now() + 3600000).toISOString()
  }));
}
