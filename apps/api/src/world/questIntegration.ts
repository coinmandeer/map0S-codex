import type { GameQuest, WorldPosition } from "@mapos/layer-sdk";
import { anchoredQuestsForBbox, verifyAnchoredQuest } from "../game/anchors.js";
/** Uses the same source registry as existing MapOS quests; never submits an external cache log. */
export class WorldQuestSources {
  private sectors = new Map<string, { until: number; quests: GameQuest[] }>();
  nearby(at: WorldPosition): GameQuest[] {
    const x = Math.floor(at.lng * 100),
      y = Math.floor(at.lat * 100),
      key = `${x}:${y}`;
    const cached = this.sectors.get(key);
    if (cached && cached.until > Date.now()) return cached.quests;
    this.sectors.set(key, { until: Date.now() + 60000, quests: cached?.quests ?? [] });
    if (this.sectors.size > 300) this.sectors.delete(this.sectors.keys().next().value!);
    void anchoredQuestsForBbox([(x - 1) / 100, (y - 1) / 100, (x + 2) / 100, (y + 2) / 100], 12)
      .then((rows) => {
        this.sectors.set(key, {
          until: Date.now() + 60000,
          quests: rows.map((q) => ({
            id: `external:${q.id}`,
            title: `Návštěva · ${q.anchorName}`,
            description: `Navštiv místo v MapOS. ${q.description} Splnění nezapisuje nález do externí služby.`,
            kind: "visit",
            lng: q.lng,
            lat: q.lat,
            radiusM: Math.min(40, q.radiusM),
            xp: 50,
            hint: "Odměna potvrzuje návštěvu v MapOS, nikoli nalezení externí keše.",
            checkpoints: [],
            startsAt: 0,
            endsAt: 8640000000000000,
            completed: false,
            checkpoint: 0,
            ownerId: "mapos-world",
            sourceUrl: q.externalUrl,
            sourceLabel: q.sourceId
          }))
        });
      })
      .catch(() => {});
    return cached?.quests ?? [];
  }
  async verify(id: string, at: WorldPosition) {
    const result = await verifyAnchoredQuest(id.slice(9), at);
    return !!result && result.distanceM <= Math.min(40, result.quest.radiusM);
  }
}
