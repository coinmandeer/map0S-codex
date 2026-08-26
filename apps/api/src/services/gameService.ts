import { eq, inArray, sql } from "drizzle-orm";
import type { Bbox } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { gameZones, gameQuests, gameGhosts, questCompletions, users } from "../db/schema.js";
import { ghostById, ghostsForBbox as spawnGhostsForBbox } from "../game/spawn.js";
import { registerReward } from "./stakingService.js";

export async function listGameZones() {
  return db.select().from(gameZones);
}

export async function listGameQuests() {
  return db.select().from(gameQuests);
}

export async function getGameState(userId?: string) {
  const zones = await listGameZones();
  const quests = await listGameQuests();
  const completed = userId
    ? (await db.select().from(questCompletions).where(eq(questCompletions.userId, userId))).map(
        (c) => c.questId
      )
    : [];
  return { zones, quests, completedQuestIds: completed };
}

const QUEST_POINT_USD = 0.05;

/** Completing a quest is the loop's payoff and must be exactly-once: the primary key is
 *  `${userId}:${questId}`, so a duplicate claim collides instead of paying out again. */
export async function completeQuest(questId: string, userId: string) {
  const [quest] = await db.select().from(gameQuests).where(eq(gameQuests.id, questId)).limit(1);
  if (!quest) throw new Error("Quest not found");

  try {
    await db.insert(questCompletions).values({
      id: `${userId}:${questId}`,
      userId,
      questId,
      rewardPoints: quest.rewardPoints
    });
  } catch {
    throw new Error("Quest already completed");
  }

  await db
    .update(users)
    .set({ xpTotal: sql`${users.xpTotal} + ${quest.rewardPoints}` })
    .where(eq(users.id, userId));

  const rewardUsd = Number((quest.rewardPoints * QUEST_POINT_USD).toFixed(4));
  await registerReward(userId, "quest_complete", rewardUsd, questId);

  return { ok: true, rewardPoints: quest.rewardPoints, rewardUsd };
}

/** Ghosts exist by derivation, not by row (see game/spawn.ts) — the table only records the
 * ones somebody has already caught, so this filters the derived set against that record.
 * Consequence worth knowing: an empty database is a fully playable world. */
export async function getGhostsForBbox(bbox: Bbox) {
  const spawned = spawnGhostsForBbox(bbox);
  if (!spawned.length) return [];

  const caught = await db
    .select({ id: gameGhosts.id })
    .from(gameGhosts)
    .where(
      inArray(
        gameGhosts.id,
        spawned.map((g) => g.id)
      )
    );
  const caughtIds = new Set(caught.map((c) => c.id));

  return spawned
    .filter((g) => !caughtIds.has(g.id))
    .map((g) => ({ id: g.id, lng: g.lng, lat: g.lat, gotchiId: g.gotchiId }));
}

export async function catchGhost(id: string, userId: string) {
  const spawn = ghostById(id);
  if (!spawn) throw new Error("Ghost not found");

  // The insert doubles as the claim: a unique primary key means two players racing for the
  // same ghost can't both win it, without needing a transaction or a lock.
  try {
    await db.insert(gameGhosts).values({
      id: spawn.id,
      cellId: spawn.cellId,
      lng: spawn.lng,
      lat: spawn.lat,
      gotchiId: spawn.gotchiId,
      caughtBy: userId,
      caughtAt: new Date()
    });
  } catch {
    throw new Error("Ghost already caught");
  }
  return { ok: true, gotchiId: spawn.gotchiId };
}
