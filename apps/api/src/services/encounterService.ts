import { and, eq, gte, lte } from "drizzle-orm";
import type { Bbox } from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { gameEncounters, gameZones } from "../db/schema.js";
import { encounterById, encountersForBbox, REWARD_BY_TIER, type LootTier } from "../game/spawn.js";
import { registerReward } from "./stakingService.js";

const MAX_VISIBLE = 3;

export interface EncounterView {
  id: string;
  lng: number;
  lat: number;
  templateKind: string;
  lootTier: string;
  zoneId: string | null;
  /** Set when the encounter sits inside a staking-gated zone, so the HUD can say why a
   *  resolve will be refused before the player walks all the way there. */
  minStakeUsd?: number;
}

/** Encounters come from two places: the deterministic per-cell world (playable everywhere in
 *  Europe with no seeding) and curated `game_zones` rows, which can carry loot tables and
 *  staking gates. Zone encounters are listed first — they're the designed content. */
export async function listEncounters(bbox: Bbox): Promise<EncounterView[]> {
  const [w, s, e, n] = bbox;
  const zones = await db
    .select()
    .from(gameZones)
    .where(
      and(
        gte(gameZones.lng, w),
        lte(gameZones.lng, e),
        gte(gameZones.lat, s),
        lte(gameZones.lat, n)
      )
    )
    .limit(MAX_VISIBLE);

  const resolved = await db
    .select({ id: gameEncounters.id })
    .from(gameEncounters)
    .where(and(gte(gameEncounters.lng, w), lte(gameEncounters.lng, e)));
  const resolvedIds = new Set(resolved.map((r) => r.id));

  const zoneEncounters: EncounterView[] = zones.map((zone) => ({
    id: `enc-zone-${zone.id}`,
    lng: zone.lng,
    lat: zone.lat,
    templateKind: "demon",
    lootTier: zone.lootTier ?? "low",
    zoneId: zone.id,
    minStakeUsd: zone.minStakeUsd > 0 ? zone.minStakeUsd : undefined
  }));

  const worldEncounters: EncounterView[] = encountersForBbox(bbox).map((enc) => ({
    id: enc.id,
    lng: enc.lng,
    lat: enc.lat,
    templateKind: enc.templateKind,
    lootTier: enc.lootTier,
    zoneId: null
  }));

  return [...zoneEncounters, ...worldEncounters]
    .filter((enc) => !resolvedIds.has(enc.id))
    .slice(0, MAX_VISIBLE);
}

export async function resolveEncounter(id: string, userId: string) {
  const [alreadyResolved] = await db
    .select()
    .from(gameEncounters)
    .where(eq(gameEncounters.id, id))
    .limit(1);
  if (alreadyResolved) throw new Error("Already resolved");

  const zoneId = id.startsWith("enc-zone-") ? id.slice("enc-zone-".length) : null;
  let lootTier: LootTier;
  let lng: number;
  let lat: number;
  let loot = "mystery shard";

  if (zoneId) {
    const [zone] = await db.select().from(gameZones).where(eq(gameZones.id, zoneId)).limit(1);
    if (!zone) throw new Error("Encounter not found");
    if (zone.zoneKind === "staker_gate" && zone.minStakeUsd > 0) {
      const { getStakingOverview } = await import("./stakingService.js");
      const staking = await getStakingOverview(userId);
      if (!staking || staking.stakedUsd < zone.minStakeUsd) {
        throw new Error(`Requires stake of $${zone.minStakeUsd}`);
      }
    }
    lootTier = (zone.lootTier as LootTier) ?? "low";
    lng = zone.lng;
    lat = zone.lat;
    loot = (zone.lootTable as string[] | null)?.[0] ?? loot;
  } else {
    const spawn = encounterById(id);
    if (!spawn) throw new Error("Encounter not found");
    lootTier = spawn.lootTier;
    lng = spawn.lng;
    lat = spawn.lat;
  }

  const rewardUsd = REWARD_BY_TIER[lootTier];
  // The row exists purely to mark this encounter as spent for this time bucket.
  await db.insert(gameEncounters).values({
    id,
    zoneId,
    lng,
    lat,
    templateKind: zoneId ? "demon" : "world",
    lootTier,
    engagedBy: userId,
    resolvedAt: new Date()
  });
  await registerReward(userId, "encounter_resolve", rewardUsd);
  return { ok: true, rewardUsd, loot };
}
