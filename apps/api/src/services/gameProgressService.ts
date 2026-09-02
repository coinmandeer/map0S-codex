import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { gameOrbCollections, users } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";

const ORB_XP = 10;
const MAX_SYNC_ORBS = 4000;

function validOrbId(userId: string, orbId: string): boolean {
  const prefix = `orb:${userId}:`;
  if (!orbId.startsWith(prefix) || orbId.length > 180) return false;
  const remainder = orbId.slice(prefix.length);
  const parts = remainder.split(":");
  // Keep accepting pre-daily ids so existing local progress can migrate. New ids include the
  // UTC day and fixed kilometre-cell key before their coordinates.
  if (
    parts.length !== 1 &&
    !(
      parts.length === 3 &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[0]!) &&
      /^-?\d+x-?\d+$/.test(parts[1]!)
    )
  )
    return false;
  const coords = parts.at(-1)!.split(",").map(Number);
  return (
    coords.length === 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1]) &&
    coords[0]! >= -180 &&
    coords[0]! <= 180 &&
    coords[1]! >= -90 &&
    coords[1]! <= 90
  );
}

function normalizeOrbIds(userId: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new ClientError("orbIds must be an array");
  if (raw.length > MAX_SYNC_ORBS) throw new ClientError("Too many orb ids");
  const ids = [...new Set(raw)];
  if (ids.some((id) => typeof id !== "string" || !validOrbId(userId, id))) {
    throw new ClientError("Invalid orb id");
  }
  return ids as string[];
}

export async function getGameProgress(userId: string) {
  const [[user], collected] = await Promise.all([
    db.select({ xpTotal: users.xpTotal }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ orbId: gameOrbCollections.orbId })
      .from(gameOrbCollections)
      .where(eq(gameOrbCollections.userId, userId))
  ]);
  if (!user) throw new ClientError("User not found", 404);
  return {
    xpTotal: user.xpTotal,
    collectedOrbIds: collected.map((row) => row.orbId),
    collectedCount: collected.length
  };
}

/** Accepts the browser's whole local set, not only the newest click. This intentionally doubles
 * as a one-time migration and an offline retry; the primary key makes every replay free. */
export async function collectGameOrbs(userId: string, rawOrbIds: unknown) {
  const orbIds = normalizeOrbIds(userId, rawOrbIds);
  return db.transaction(async (tx) => {
    const inserted = orbIds.length
      ? await tx
          .insert(gameOrbCollections)
          .values(
            orbIds.map((orbId) => ({
              id: `${userId}:${orbId}`,
              userId,
              orbId,
              xpPoints: ORB_XP
            }))
          )
          .onConflictDoNothing()
          .returning({ orbId: gameOrbCollections.orbId })
      : [];

    const deltaXp = inserted.length * ORB_XP;
    if (deltaXp) {
      await tx
        .update(users)
        .set({ xpTotal: sql`${users.xpTotal} + ${deltaXp}` })
        .where(eq(users.id, userId));
    }

    const [[user], [count]] = await Promise.all([
      tx.select({ xpTotal: users.xpTotal }).from(users).where(eq(users.id, userId)).limit(1),
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(gameOrbCollections)
        .where(eq(gameOrbCollections.userId, userId))
    ]);
    if (!user) throw new ClientError("User not found", 404);
    return {
      xpTotal: user.xpTotal,
      collectedCount: count?.value ?? 0,
      acceptedCount: inserted.length
    };
  });
}

export const __testing = { normalizeOrbIds, validOrbId, ORB_XP, MAX_SYNC_ORBS };
