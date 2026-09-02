import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { rewardEvents, stakingPositions } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";

const APY = 0.03;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

async function ensurePosition(userId: string) {
  await db.insert(stakingPositions).values({ userId }).onConflictDoNothing();
}

async function accrue(userId: string) {
  await ensurePosition(userId);
  const [row] = await db
    .select()
    .from(stakingPositions)
    .where(eq(stakingPositions.userId, userId))
    .limit(1);
  if (!row) return null;
  const elapsed = Math.max(0, (Date.now() - row.lastYieldAt.getTime()) / 1000);
  const added = row.stakedUsd * APY * (elapsed / SECONDS_PER_YEAR);
  const pending = Number((row.pendingYieldUsd + added).toFixed(6));
  await db
    .update(stakingPositions)
    .set({ pendingYieldUsd: pending, lastYieldAt: new Date(), updatedAt: new Date() })
    .where(eq(stakingPositions.userId, userId));
  const [next] = await db
    .select()
    .from(stakingPositions)
    .where(eq(stakingPositions.userId, userId))
    .limit(1);
  return next ?? null;
}

function resolveTier(stakedUsd: number) {
  if (stakedUsd >= 100) return "tier100";
  if (stakedUsd >= 10) return "tier10";
  return "none";
}

export async function getStakingOverview(userId: string) {
  const row = await accrue(userId);
  if (!row) return null;
  return {
    stakedUsd: row.stakedUsd,
    pendingYieldUsd: row.pendingYieldUsd,
    totalWithdrawnUsd: row.totalWithdrawnUsd,
    totalQuestRewardsUsd: row.totalQuestRewardsUsd,
    tier: resolveTier(row.stakedUsd),
    apy: APY
  };
}

export async function stakeUsd(userId: string, amountUsd: number) {
  if (amountUsd <= 0) throw new ClientError("Invalid amount");
  const row = await accrue(userId);
  if (!row) throw new ClientError("No staking position");
  await db
    .update(stakingPositions)
    .set({ stakedUsd: row.stakedUsd + amountUsd, updatedAt: new Date() })
    .where(eq(stakingPositions.userId, userId));
  return getStakingOverview(userId);
}

export async function unstakeUsd(userId: string, amountUsd: number) {
  if (amountUsd <= 0) throw new ClientError("Invalid amount");
  const row = await accrue(userId);
  if (!row || amountUsd > row.stakedUsd) {
    throw new ClientError("Cannot unstake more than staked");
  }
  await db
    .update(stakingPositions)
    .set({ stakedUsd: row.stakedUsd - amountUsd, updatedAt: new Date() })
    .where(eq(stakingPositions.userId, userId));
  return getStakingOverview(userId);
}

export async function registerReward(
  userId: string,
  source: string,
  amountUsd: number,
  questId?: string
) {
  await ensurePosition(userId);
  await db
    .insert(rewardEvents)
    .values({ userId, source, amountUsd, questId: questId ?? null, details: {} });
  if (source.includes("quest") || source.includes("encounter")) {
    const row = await accrue(userId);
    if (row) {
      await db
        .update(stakingPositions)
        .set({ totalQuestRewardsUsd: row.totalQuestRewardsUsd + amountUsd, updatedAt: new Date() })
        .where(eq(stakingPositions.userId, userId));
    }
  }
}

export async function listRewardEvents(userId: string, limit = 10) {
  return db
    .select()
    .from(rewardEvents)
    .where(eq(rewardEvents.userId, userId))
    .orderBy(desc(rewardEvents.createdAt))
    .limit(limit);
}
