import { eq, inArray, sql } from "drizzle-orm";
import type { Bbox } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { gameZones, gameQuests, gameGhosts, questCompletions, users } from "../db/schema.js";
import { ghostById, ghostsForBbox as spawnGhostsForBbox } from "../game/spawn.js";
import {
  parseAnchoredQuestId,
  verifyAnchoredQuest,
  COMPLETION_RADIUS_M,
  type AnchoredQuest
} from "../game/anchors.js";
import { cachedAnchoredQuestsForBbox } from "../game/questAnchorCache.js";
import { registerDbQuestSources } from "../game/anchorSources.js";
import { composeGameZones } from "../game/worldZones.js";
import { ClientError } from "../utils/clientError.js";
import { registerReward } from "./stakingService.js";

registerDbQuestSources();

export async function listGameZones() {
  return db.select().from(gameZones);
}

export async function listGameQuests() {
  return db.select().from(gameQuests);
}

export async function getGameState(userId?: string, bbox?: Bbox) {
  const curatedZones = await listGameZones();
  const seeded = await listGameQuests();
  // Anchored quests only exist relative to a viewport, so they join the list when the client
  // says where it is looking; without a bbox the state is just the curated set. Read from the
  // anchor cache, so panning the map does not become a burst of third-party requests.
  const anchored = bbox ? await cachedAnchoredQuestsForBbox(bbox) : [];
  const completed = userId
    ? (await db.select().from(questCompletions).where(eq(questCompletions.userId, userId))).map(
        (c) => c.questId
      )
    : [];
  const completedSet = new Set(completed);
  return {
    zones: composeGameZones(curatedZones, anchored, bbox),
    quests: [
      ...seeded.map((q) => ({ ...q, anchored: false as const })),
      ...anchored
        .filter((q) => !completedSet.has(q.id))
        .map((q) => ({
          id: q.id,
          zoneId: null,
          title: q.title,
          description: q.description,
          rewardPoints: q.rewardPoints,
          lng: q.lng,
          lat: q.lat,
          anchored: true as const,
          sourceId: q.sourceId,
          anchorName: q.anchorName
        }))
    ],
    completedQuestIds: completed
  };
}

const QUEST_POINT_USD = 0.05;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CompleteQuestOptions {
  /** Where the player claims to be. Required for anchored quests, which are only claimable
   *  on site — a seeded quest keeps its old "tap to claim" behaviour. */
  at?: { lng: number; lat: number };
}

/** Completing a quest is the loop's payoff and must be exactly-once: the primary key is
 *  `${userId}:${questId}`, so a duplicate claim collides instead of paying out again. */
export async function completeQuest(
  questId: string,
  userId: string,
  options: CompleteQuestOptions = {}
) {
  const rewardPoints = await resolveReward(questId, options.at);

  try {
    await db.insert(questCompletions).values({
      id: `${userId}:${questId}`,
      userId,
      questId,
      rewardPoints
    });
  } catch {
    throw new ClientError("Quest already completed");
  }

  const [updatedUser] = await db
    .update(users)
    .set({ xpTotal: sql`${users.xpTotal} + ${rewardPoints}` })
    .where(eq(users.id, userId))
    .returning({ xpTotal: users.xpTotal });

  const rewardUsd = Number((rewardPoints * QUEST_POINT_USD).toFixed(4));
  await registerReward(userId, "quest_complete", rewardUsd, questId);

  return { ok: true, rewardPoints, rewardUsd, xpTotal: updatedUser?.xpTotal ?? rewardPoints };
}

/** Decides what a claim is worth, and whether it is legitimate at all. The reward comes from
 *  the source of truth on the server — never from the request. */
async function resolveReward(questId: string, at?: { lng: number; lat: number }): Promise<number> {
  if (!parseAnchoredQuestId(questId)) {
    // Postgres rejects a malformed uuid with an error rather than an empty result, so anything
    // that isn't one is "not found" before it reaches the query.
    if (!UUID_RE.test(questId)) throw new ClientError("Quest not found", 404);
    const [quest] = await db.select().from(gameQuests).where(eq(gameQuests.id, questId)).limit(1);
    if (!quest) throw new ClientError("Quest not found", 404);
    return quest.rewardPoints;
  }

  if (!at) throw new ClientError("Poloha je potřeba k potvrzení questu");
  const verified = await verifyAnchoredQuest(questId, at);
  if (!verified) throw new ClientError("Quest not found", 404);
  if (!verified.withinRange) {
    throw new ClientError(
      `Jsi ${Math.round(verified.distanceM)} m daleko, potřebuješ být do ${COMPLETION_RADIUS_M} m`
    );
  }
  return verified.quest.rewardPoints;
}

/** Ghosts exist by derivation, not by row (see game/spawn.ts) — the table only records the
 * ones somebody has already caught, so this filters the derived set against that record.
 * Consequence worth knowing: an empty database is a fully playable world. */
/** Quests anchored to what is actually near a place (§2.11, §10 "Questy na místo/oblast").
 *
 *  A place detail asks "is there something to do right here", which is a smaller question than
 *  the viewport sweep. The search reuses the same anchor cache, so opening a detail does not
 *  become its own third-party request, and every quest reports how far it is so the panel can
 *  say whether the reader can actually walk to it. */
export async function questsNear(
  lng: number,
  lat: number,
  radiusKm = 3
): Promise<Array<AnchoredQuest & { distanceM: number }>> {
  const clamped = Math.min(Math.max(radiusKm, 0.25), 10);
  const dy = clamped / 111.32;
  const dx = dy / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const bbox: Bbox = [
    Math.max(-180, lng - dx),
    Math.max(-90, lat - dy),
    Math.min(180, lng + dx),
    Math.min(90, lat + dy)
  ];
  const quests = await cachedAnchoredQuestsForBbox(bbox, 40);
  const rad = Math.PI / 180;
  return quests
    .map((quest) => {
      const a =
        Math.sin(((quest.lat - lat) * rad) / 2) ** 2 +
        Math.cos(lat * rad) *
          Math.cos(quest.lat * rad) *
          Math.sin(((quest.lng - lng) * rad) / 2) ** 2;
      const distanceM = Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
      return { ...quest, distanceM };
    })
    .filter((quest) => quest.distanceM <= clamped * 1000)
    .sort((left, right) => left.distanceM - right.distanceM)
    .slice(0, 12);
}

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
  if (!spawn) throw new ClientError("Ghost not found", 404);

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
    throw new ClientError("Ghost already caught");
  }
  return { ok: true, gotchiId: spawn.gotchiId };
}
