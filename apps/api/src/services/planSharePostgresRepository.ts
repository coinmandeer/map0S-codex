import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { planShareLinks } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import { getPlanDocument } from "./tripPlanStore.js";
import type { PlanShareLink, PlanShareRepository } from "./planShareRepository.js";

function publicLink(row: typeof planShareLinks.$inferSelect): PlanShareLink {
  return {
    id: row.id,
    planId: row.planId,
    permission: "view",
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null
  };
}

export const postgresPlanShareRepository: PlanShareRepository = {
  async list(ownerId, planId) {
    const rows = await db
      .select()
      .from(planShareLinks)
      .where(and(eq(planShareLinks.ownerUserId, ownerId), eq(planShareLinks.planId, planId)))
      .orderBy(desc(planShareLinks.createdAt));
    return rows.map(publicLink);
  },

  async create(ownerId, planId, tokenHash, permission) {
    const [row] = await db
      .insert(planShareLinks)
      .values({ ownerUserId: ownerId, planId, tokenHash, permission })
      .returning();
    if (!row) throw new Error("Plan share link was not created");
    return publicLink(row);
  },

  async resolve(tokenHash) {
    const [row] = await db
      .select()
      .from(planShareLinks)
      .where(and(eq(planShareLinks.tokenHash, tokenHash), isNull(planShareLinks.revokedAt)))
      .limit(1);
    if (!row) return null;
    const plan = await getPlanDocument(row.ownerUserId, row.planId);
    return plan ? { share: publicLink(row), plan } : null;
  },

  async revoke(ownerId, planId, shareId) {
    const rows = await db
      .update(planShareLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(planShareLinks.id, shareId),
          eq(planShareLinks.ownerUserId, ownerId),
          eq(planShareLinks.planId, planId)
        )
      )
      .returning({ id: planShareLinks.id });
    if (!rows.length) throw new ClientError("Odkaz nebyl nalezen", 404);
  }
};
