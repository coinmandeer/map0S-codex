import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  GameAction,
  GameQuest,
  GameSession,
  RewardGrant,
  WorldEntity,
  WorldMode,
  WorldPosition,
  WorldProfile,
  WorldProgress,
  WorldSnapshot,
  WorldZoneSummary
} from "@mapos/layer-sdk";
import { WORLD_REWARDS } from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { distance, type WorldRecord, type WorldRepository } from "./repository.js";

export function point(value: unknown): WorldPosition {
  const p = value as WorldPosition;
  if (
    !p ||
    !Number.isFinite(p.lng) ||
    !Number.isFinite(p.lat) ||
    Math.abs(p.lng) > 180 ||
    Math.abs(p.lat) > 85
  )
    throw new ClientError("Neplatná poloha");
  return { lng: p.lng, lat: p.lat };
}
export function text(value: unknown, max = 1600): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ClientError(`Text musí mít 1–${max} znaků`);
  return value.trim();
}
export function record(value: { id: string }): WorldRecord {
  return value as unknown as WorldRecord;
}
export interface LivePlayer {
  userId: string;
  session: GameSession;
  position: WorldPosition | null;
  positionAt: number;
  accuracy: number;
  hp: number;
  shootReadyAt: number;
  castReadyAt: number;
  lastSeen: number;
  presenceId: string;
  visible: boolean;
  checkIn: { title: string; lng: number; lat: number; expiresAt: number } | null;
  precise: Map<string, number>;
}
interface Fight {
  entity: WorldEntity;
  members: Map<string, { hits: number; lastHit: number; nextAttack: number }>;
  updatedAt: number;
  mode: WorldMode;
}
interface StoredQuest extends Omit<GameQuest, "completed" | "checkpoint"> {
  answerHash: string;
  mode: WorldMode;
}
interface StoredProgress extends WorldProgress {
  id: string;
  userId: string;
  mode: WorldMode;
  completed: string[];
  checkpoints: Record<string, number>;
  createdAt: number;
}
export interface WorldOptions {
  testEnabled: boolean;
  now?: () => number;
  profile: (id: string) => Promise<WorldProfile | null>;
  initialXp?: (id: string) => Promise<number>;
  externalQuests?: {
    nearby(at: WorldPosition): GameQuest[];
    verify(id: string, at: WorldPosition): Promise<boolean>;
  };
  verifyToken?: (userId: string, tokenId: string) => Promise<void>;
}
/** One cell is roughly 1.1 km; zones and their spawns derive from the cell, so two players on
 *  the same street see the same ring, the same guardian and the same coins. */
const CELL_DEG = 0.01;
const HOUR_MS = 3_600_000;
const COIN_RESPAWN_MS = 10 * 60_000;
const ZONE_REACH_M = 1100;
const ENTITY_LIMIT = 80;

function zoneName(kind: WorldZoneSummary["zoneKind"]): string {
  return kind === "event"
    ? "Eventová zóna"
    : kind === "staker_gate"
      ? "Zóna stakerů"
      : "Zóna průzkumu";
}
export class GameWorld {
  readonly players = new Map<string, LivePlayer>();
  /** Coins are shared: one player's pickup hides the coin from everyone for a short window. */
  private collectedCoins = new Map<string, number>();
  private fights = new Map<string, Fight>();
  protected now: () => number;
  private lastStamp = 0;
  private mutating = false;
  private actionTail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly repository: WorldRepository,
    readonly options: WorldOptions
  ) {
    this.now = options.now ?? Date.now;
  }
  protected stamp() {
    this.lastStamp = Math.max(this.now(), this.lastStamp + 1);
    return this.lastStamp;
  }
  profile(id: string) {
    return this.options.profile(id);
  }
  protected serialize<T>(fn: () => Promise<T>) {
    const result = this.actionTail.then(fn);
    this.actionTail = result.catch(() => {});
    return result;
  }
  prune() {
    for (const [key, player] of this.players) {
      if (this.now() - player.positionAt > 120_000) player.position = null;
      if (this.now() - player.lastSeen > 45_000) {
        player.visible = false;
        player.checkIn = null;
      }
      if (this.now() > player.session.expiresAt) this.players.delete(key);
    }
    for (const [id, fight] of this.fights)
      if (this.now() - fight.updatedAt > 120_000) this.fights.delete(id);
    for (const [id, until] of this.collectedCoins)
      if (until <= this.now()) this.collectedCoins.delete(id);
  }
  private cellHash(...parts: Array<string | number>): number {
    let hash = 2166136261;
    for (const part of parts) {
      const text = String(part);
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return hash >>> 0;
  }
  /** Zones and their occupants, derived from the cell and the current window. A zone that is
   *  about to close is presented as the next window's zone with a countdown to its start, so
   *  the board always has something to wait for. Killed guardians are remembered per window. */
  private zoneSpawns(at: WorldPosition, mode: WorldMode) {
    const sx = Math.floor(at.lng / CELL_DEG),
      sy = Math.floor(at.lat / CELL_DEG);
    const out: Array<{
      zone: WorldZoneSummary;
      guardian: WorldEntity;
      chest: WorldEntity;
      coins: WorldEntity[];
    }> = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const x = sx + dx,
          y = sy + dy;
        const h = this.cellHash(mode, x, y);
        const kind: WorldZoneSummary["zoneKind"] = (["standard", "event", "staker_gate"] as const)[
          h % 3
        ]!;
        const duration =
          kind === "standard" ? 24 * HOUR_MS : kind === "event" ? 4 * HOUR_MS : 8 * HOUR_MS;
        const windowIndex = Math.floor(this.now() / duration);
        const windowFrom = windowIndex * duration;
        const windowUntil = windowFrom + duration;
        // The last tenth of a window belongs to the next one: the ring fades to a scheduled
        // preview, so a zone that is about to expire already shows its successor.
        const scheduled = windowUntil - this.now() < duration / 10;
        const activeFrom = scheduled ? windowUntil : windowFrom;
        const activeUntil = scheduled ? windowUntil + duration : windowUntil;
        const id = `${mode}:zone:${kind}:${Math.floor(activeFrom / duration)}:${x}:${y}`;
        const center: WorldPosition = {
          lng: (x + 0.25 + ((h >>> 3) % 50) / 100) * CELL_DEG,
          lat: (y + 0.25 + ((h >>> 8) % 50) / 100) * CELL_DEG
        };
        const zone: WorldZoneSummary = {
          id,
          name: zoneName(kind),
          zoneKind: kind,
          lng: center.lng,
          lat: center.lat,
          radiusM: 120 + ((h >>> 13) % 121),
          lifecycle: scheduled ? "scheduled" : "active",
          startsInSeconds: scheduled ? Math.round((activeFrom - this.now()) / 1000) : null,
          endsInSeconds: scheduled
            ? null
            : Math.max(0, Math.round((activeUntil - this.now()) / 1000))
        };
        const bossWindow =
          kind === "event" &&
          !scheduled &&
          activeUntil - this.now() < (activeUntil - activeFrom) / 4;
        const guardianKind: WorldEntity["kind"] =
          bossWindow || (kind === "staker_gate" && (h >>> 17) % 3 === 0) ? "boss" : "lickquidator";
        const guardianHp = guardianKind === "boss" ? 600 : 60;
        const guardian: WorldEntity = {
          id: `${id}:guard`,
          kind: guardianKind,
          name: guardianKind === "boss" ? "Strážce zóny" : "Zónový lickquidator",
          lng: center.lng,
          lat: center.lat,
          variant: (h >>> 19) % 4,
          hp: guardianHp,
          maxHp: guardianHp,
          engaged: false,
          phase: 1,
          participants: 0
        };
        const chestOffset = ((h >>> 21) % 40) / 100 - 0.2;
        const chest: WorldEntity = {
          id: `${id}:chest`,
          kind: "chest",
          name: "Truhla v zóně",
          lng:
            center.lng +
            (chestOffset * zone.radiusM) / (111320 * Math.cos((center.lat * Math.PI) / 180)),
          lat: center.lat + (chestOffset * zone.radiusM) / 111320,
          variant: (h >>> 24) % 4,
          hp: 0,
          maxHp: 0,
          engaged: false,
          phase: 1,
          participants: 0
        };
        const ring = zone.radiusM * 0.45;
        const coins: WorldEntity[] = Array.from({ length: 5 }, (_, index) => {
          const angle = (((h >>> 3) % 360) + index * 72) * (Math.PI / 180);
          return {
            id: `${id}:coin:${index}`,
            kind: "coin" as const,
            name: "Zlomek GHST",
            lng:
              center.lng +
              (Math.cos(angle) * ring) / (111320 * Math.cos((center.lat * Math.PI) / 180)),
            lat: center.lat + (Math.sin(angle) * ring) / 111320,
            variant: index % 4,
            hp: 0,
            maxHp: 0,
            engaged: false,
            phase: 1,
            participants: 0
          };
        });
        out.push({ zone, guardian, chest, coins });
      }
    return out;
  }
  /** Zones worth drawing around a position. */
  zones(at: WorldPosition, mode: WorldMode): WorldZoneSummary[] {
    return this.zoneSpawns(at, mode)
      .filter((spawn) => distance(at, spawn.zone) < 2000)
      .map((spawn) => spawn.zone);
  }
  player(userId: string, sessionId: string): LivePlayer {
    this.prune();
    const p = [...this.players.values()].find(
      (p) => p.userId === userId && p.session.id === sessionId
    );
    if (!p) throw new ClientError("Herní spojení vypršelo. Připoj se znovu.", 409);
    if (p.session.mode === "test" && !this.options.testEnabled)
      throw new ClientError("Testovací pohyb je vypnutý", 403);
    return p;
  }
  start(userId: string, mode: WorldMode): GameSession {
    if (mode !== "gps" && mode !== "test" && mode !== "explore")
      throw new ClientError("Neplatný režim");
    if (mode === "test" && !this.options.testEnabled)
      throw new ClientError("Testovací pohyb je vypnutý", 403);
    const key = `${userId}:${mode}`;
    const previous = this.players.get(key);
    if (previous && previous.session.expiresAt > this.now()) {
      previous.lastSeen = this.now();
      return { ...previous.session };
    }
    const session: GameSession = {
      id: randomUUID(),
      mode,
      avatarTokenId: null,
      expiresAt: this.now() + 12 * 3600_000
    };
    this.players.set(key, {
      userId,
      session,
      position: null,
      positionAt: 0,
      accuracy: Infinity,
      hp: 100,
      shootReadyAt: 0,
      castReadyAt: 0,
      lastSeen: this.now(),
      presenceId: randomUUID(),
      visible: false,
      checkIn: null,
      precise: new Map()
    });
    return { ...session };
  }
  end(userId: string, sessionId: string) {
    const p = this.player(userId, sessionId);
    this.players.delete(`${userId}:${p.session.mode}`);
  }
  position(
    userId: string,
    sessionId: string,
    input: unknown,
    accuracy: unknown,
    observedAt: unknown = this.now()
  ) {
    const p = this.player(userId, sessionId),
      position = point(input);
    if (
      typeof accuracy !== "number" ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 10000
    )
      throw new ClientError("Neplatná přesnost GPS");
    if (p.position && this.now() - p.positionAt < 120_000 && p.session.mode === "gps") {
      const elapsed = Math.max(1, (this.now() - p.positionAt) / 1000);
      if (distance(p.position, position) > elapsed * 12 + p.accuracy + accuracy + 25)
        throw new ClientError("Poloha se změnila příliš rychle", 409);
    }
    if (
      typeof observedAt !== "number" ||
      !Number.isFinite(observedAt) ||
      observedAt > this.now() + 5000 ||
      this.now() - observedAt > 30000
    )
      throw new ClientError("GPS měření je zastaralé", 409);
    p.position = position;
    p.accuracy = p.session.mode !== "gps" ? 0 : accuracy;
    p.positionAt = Math.min(this.now(), observedAt);
    p.lastSeen = this.now();
  }
  protected ready(p: LivePlayer): WorldPosition {
    if (!p.position || this.now() - p.positionAt > 30_000 || p.accuracy > 40)
      throw new ClientError("Pro tuto akci potřebuješ aktuální přesnou polohu", 409);
    return p.position;
  }
  async selectAvatar(userId: string, sessionId: string, tokenId: string) {
    text(tokenId, 78);
    if (!/^\d+$/.test(tokenId) || !this.options.verifyToken)
      throw new ClientError("Ověření Aavegotchi není dostupné", 503);
    await this.options.verifyToken(userId, tokenId);
    this.player(userId, sessionId).session.avatarTokenId = tokenId;
  }
  private async progress(
    userId: string,
    mode: WorldMode,
    tx = this.repository
  ): Promise<StoredProgress> {
    const id = `${mode}:${userId}`;
    const stored = await tx.get<StoredProgress>("profiles", id);
    if (stored) {
      if (mode === "gps")
        stored.xp = Math.max(stored.xp, (await this.options.initialXp?.(userId)) ?? 0);
      return stored;
    }
    return {
      id,
      userId,
      mode,
      xp: mode === "gps" ? ((await this.options.initialXp?.(userId)) ?? 0) : 0,
      level: 1,
      items: {},
      badges: [],
      completed: [],
      checkpoints: {},
      createdAt: this.now()
    };
  }
  private entities(at: WorldPosition, mode: WorldMode): WorldEntity[] {
    const sx = Math.floor(at.lng / 0.01),
      sy = Math.floor(at.lat / 0.01);
    const day = Math.floor(this.now() / 86400_000);
    const entities: WorldEntity[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = sx + dx,
          y = sy + dy;
        const specs: [WorldEntity["kind"], number, number, string, number][] = [
          ["essence", 0.2, 0.2, "Tyrkysová esence", 0],
          ["essence", 0.4, 0.4, "Fialová esence", 0],
          ["essence", 0.6, 0.6, "Zlatá esence", 0],
          ["essence", 0.8, 0.8, "Růžová esence", 0],
          ["chest", 0.5, 0.35, "Truhla průzkumníka", 0],
          ["lickquidator", 0.5, 0.5, "Lickquidator", 60],
          ["boss", 0.7, 0.5, "Strážce portálu", 600],
          ["portal", 0.7, 0.53, "Portál · raid pro 2–8", 0]
        ];
        specs.forEach(([kind, ox, oy, name, hp], index) => {
          const id = `${mode}:${day}:${x}:${y}:${index}`;
          const e: WorldEntity = {
            id,
            kind,
            name,
            lng: (x + ox) * 0.01,
            lat: (y + oy) * 0.01,
            variant: index % 4,
            hp,
            maxHp: hp,
            engaged: false,
            phase: 1,
            participants: 0
          };
          if (distance(at, e) < 1100) entities.push(this.fights.get(id)?.entity ?? e);
        });
      }
    // Zone occupants: the ring is the objective, the guardian and the coins are the gameplay.
    for (const spawn of this.zoneSpawns(at, mode))
      for (const entity of [spawn.guardian, spawn.chest, ...spawn.coins]) {
        if (entity.kind === "coin" && (this.collectedCoins.get(entity.id) ?? 0) > this.now())
          continue;
        if (distance(at, entity) < ZONE_REACH_M)
          entities.push(this.fights.get(entity.id)?.entity ?? entity);
      }
    return entities
      .sort((a, b) => distance(at, a) - distance(at, b))
      .slice(0, ENTITY_LIMIT)
      .map((e) => ({ ...e }));
  }
  async snapshot(userId: string, sessionId: string): Promise<WorldSnapshot> {
    const p = this.player(userId, sessionId);
    p.lastSeen = this.now();
    const progress = await this.progress(userId, p.session.mode);
    const finished = new Set(
      (
        await this.repository.list<{ id: string }>("raid_results", {
          equals: { mode: p.session.mode },
          limit: 10000
        })
      ).map((r) => r.id)
    );
    const entities = p.position
      ? this.entities(p.position, p.session.mode).filter(
          (e) => !progress.completed.includes(e.id) && !finished.has(e.id)
        )
      : [];
    const quests = p.position
      ? await this.repository.list<StoredQuest>("quests", {
          equals: { mode: p.session.mode },
          area: { ...p.position, radius: 10000 },
          limit: 50
        })
      : [];
    const fight = [...this.fights.values()].find(
      (f) =>
        f.mode === p.session.mode &&
        f.entity.hp > 0 &&
        f.members.has(userId) &&
        p.position &&
        distance(p.position, f.entity) <= 90
    );
    const arena = fight
      ? {
          entityId: fight.entity.id,
          participants: [...fight.members.keys()].map((id, index) => {
            const angle = (index / 8) * Math.PI * 2;
            return {
              id: this.players.get(`${id}:${p.session.mode}`)?.presenceId ?? "departed",
              self: id === userId,
              position: {
                lng:
                  fight.entity.lng +
                  (Math.cos(angle) * 10) / (111320 * Math.cos((fight.entity.lat * Math.PI) / 180)),
                lat: fight.entity.lat + (Math.sin(angle) * 10) / 111320
              }
            };
          })
        }
      : null;
    const gamePosition = arena?.participants.find((p) => p.self)?.position ?? p.position;
    const raidQuests: GameQuest[] = entities
      .filter((e) => e.kind === "boss" || e.kind === "lickquidator")
      .map((e) => ({
        id: e.id,
        title: e.name,
        description:
          e.kind === "boss"
            ? "Spojte síly u portálu a porazte strážce. Každý aktivní účastník získá svou odměnu."
            : "Dojdi ke strážci a poraz ho. Získáš XP a úlomek pro vylepšení zbraně.",
        kind: e.kind === "boss" ? "raid" : "combat",
        lng: e.lng,
        lat: e.lat,
        radiusM: e.kind === "boss" ? 90 : 70,
        xp: e.kind === "boss" ? WORLD_REWARDS.raid : WORLD_REWARDS.enemy,
        hint:
          e.kind === "boss"
            ? "Vstup potvrď u bosse. Potřebujete 2–8 hráčů."
            : "Přibliž se na 70 m, vstup do souboje a použij Útok nebo Fireball.",
        checkpoints: [],
        startsAt: Math.floor(this.now() / 86400000) * 86400000,
        endsAt: (Math.floor(this.now() / 86400000) + 1) * 86400000,
        completed: false,
        checkpoint: 0,
        ownerId: "mapos-world"
      }));
    return {
      physicalPosition:
        p.session.mode === "gps" && p.position
          ? { ...p.position, accuracy: p.accuracy, observedAt: p.positionAt }
          : null,
      gamePosition,
      arena,
      session: { ...p.session },
      serverTime: this.now(),
      position: p.position,
      positionReady: !!p.position && p.accuracy <= 40 && this.now() - p.positionAt <= 30000,
      hp: p.hp,
      maxHp: 100,
      shootReadyAt: p.shootReadyAt,
      castReadyAt: p.castReadyAt,
      entities,
      zones: p.position ? this.zones(p.position, p.session.mode) : [],
      quests: [
        ...raidQuests,
        ...(p.position ? (this.options.externalQuests?.nearby(p.position) ?? []) : []).map((q) => ({
          ...q,
          completed: progress.completed.includes(q.id)
        })),
        ...quests
          .filter((q) => q.endsAt > this.now())
          .map(({ answerHash: _secret, mode: _mode, ...q }) => ({
            ...q,
            completed: progress.completed.includes(q.id),
            checkpoint: progress.checkpoints[q.id] ?? 0
          }))
      ],
      progress: {
        xp: progress.xp,
        level: Math.floor(progress.xp / 100) + 1,
        items: progress.items,
        badges: progress.badges,
        coins: progress.coins ?? 0,
        weaponLevel: progress.weaponLevel ?? 0
      }
    };
  }
  private async reward(
    tx: WorldRepository,
    p: LivePlayer,
    sourceId: string,
    xp: number,
    item: string | null,
    badge?: string,
    coins = 0,
    /** Shared pickups keep respawning; only a one-time find belongs in `completed`. */
    trackCompleted = true
  ) {
    const id = `${p.session.mode}:${p.userId}:${sourceId}`;
    if (await tx.get("rewards", id)) return;
    const grant: RewardGrant = {
      id,
      userId: p.userId,
      mode: p.session.mode,
      sourceId,
      xp,
      item,
      at: this.now()
    };
    const progress = await this.progress(p.userId, p.session.mode, tx);
    progress.xp += xp;
    if (coins) progress.coins = (progress.coins ?? 0) + coins;
    if (trackCompleted) progress.completed.push(sourceId);
    if (item) progress.items[item] = (progress.items[item] ?? 0) + 1;
    if (badge && !progress.badges.includes(badge)) progress.badges.push(badge);
    await tx.put("rewards", record(grant));
    await tx.put("profiles", record(progress));
  }
  async action(userId: string, sessionId: string, action: GameAction) {
    if (
      !action ||
      !["collect", "engage", "shoot", "cast", "quest", "upgrade"].includes(action.type)
    )
      throw new ClientError("Neznámá akce");
    text(action.actionId, 100);
    text(action.targetId, 200);
    let externalVerified = false;
    if (action.type === "quest" && action.targetId.startsWith("external:")) {
      const p = this.player(userId, sessionId);
      externalVerified = !!(await this.options.externalQuests?.verify(
        action.targetId,
        this.ready(p)
      ));
      if (!externalVerified) throw new ClientError("Přibliž se k ověřenému cíli questu", 409);
    }
    return this.serialize(async () => {
      const p = this.player(userId, sessionId);
      const receiptId = `${p.session.mode}:${userId}:${action.actionId}`;
      const fingerprint = JSON.stringify([
        action.type,
        action.targetId,
        action.type === "quest" ? (action.answer ?? null) : null
      ]);
      const previousFights = structuredClone(this.fights),
        previousPlayer = { hp: p.hp, shootReadyAt: p.shootReadyAt, castReadyAt: p.castReadyAt };
      this.mutating = true;
      try {
        await this.repository.transaction(async (tx) => {
          const previous = await tx.get<{ fingerprint: string }>("actions", receiptId);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              throw new ClientError("Identifikátor akce už byl použit", 409);
            return;
          }
          const at = this.ready(p);
          if (action.type === "upgrade") {
            if (action.targetId !== "weapon") throw new ClientError("Neznámé vylepšení");
            const progress = await this.progress(userId, p.session.mode, tx);
            const level = progress.weaponLevel ?? 0;
            const cost = 3 * (level + 1);
            if (level >= 5) throw new ClientError("Zbraň už má nejvyšší úroveň", 409);
            if ((progress.items["Úlomek strážce"] ?? 0) < cost)
              throw new ClientError(`Potřebuješ ${cost} úlomků strážce`, 409);
            progress.items["Úlomek strážce"] -= cost;
            progress.weaponLevel = level + 1;
            await tx.put("profiles", record(progress));
            await tx.put("actions", {
              id: receiptId,
              userId,
              mode: p.session.mode,
              fingerprint,
              createdAt: this.now()
            });
            return;
          }
          if (action.type === "quest") {
            await this.completeQuest(p, action.targetId, action.answer, tx, externalVerified);
            await tx.put("actions", {
              id: receiptId,
              userId,
              mode: p.session.mode,
              fingerprint,
              createdAt: this.now()
            });
            return;
          }
          const entity = this.entities(at, p.session.mode).find((e) => e.id === action.targetId);
          if (await tx.get("raid_results", action.targetId))
            throw new ClientError("Souboj už skončil", 409);
          if (!entity) throw new ClientError("Objekt není v okolí", 404);
          if (
            distance(at, entity) >
            (entity.kind === "boss" ? 90 : action.type === "collect" ? 22 : 70)
          )
            throw new ClientError("Přibliž se k cíli", 409);
          if (action.type === "collect") {
            if (!["essence", "chest", "coin"].includes(entity.kind))
              throw new ClientError("Tento objekt nelze sebrat");
            if (entity.kind === "coin" && (this.collectedCoins.get(entity.id) ?? 0) > this.now())
              throw new ClientError("Tuhle minci už někdo sebral", 409);
            await this.reward(
              tx,
              p,
              entity.id,
              entity.kind === "coin" ? WORLD_REWARDS.coin : WORLD_REWARDS.essence,
              entity.kind === "chest"
                ? "Klíč portálu"
                : entity.kind === "coin"
                  ? null
                  : ["Tyrkysová esence", "Fialová esence", "Zlatá esence", "Růžová esence"][
                      entity.variant
                    ]!,
              undefined,
              entity.kind === "coin" ? 1 : 0,
              entity.kind !== "coin"
            );
            if (entity.kind === "coin")
              this.collectedCoins.set(entity.id, this.now() + COIN_RESPAWN_MS);
          } else {
            if (!["lickquidator", "boss"].includes(entity.kind))
              throw new ClientError("Tento objekt není nepřítel");
            let fight = this.fights.get(entity.id);
            if (action.type === "engage") {
              if (!fight) {
                fight = {
                  entity: { ...entity, engaged: true },
                  members: new Map(),
                  updatedAt: this.now(),
                  mode: p.session.mode
                };
                this.fights.set(entity.id, fight);
              }
              if (fight.entity.hp <= 0) throw new ClientError("Souboj už skončil", 409);
              if (fight.members.size >= 8 && !fight.members.has(userId))
                throw new ClientError("Raid je plný", 409);
              fight.members.set(
                userId,
                fight.members.get(userId) ?? {
                  hits: 0,
                  lastHit: this.now(),
                  nextAttack: this.now() + 2500
                }
              );
              fight.entity.participants = fight.members.size;
              fight.updatedAt = this.now();
              if (p.hp <= 0) p.hp = 100;
            } else {
              if (!fight?.members.has(userId))
                throw new ClientError("Nejdřív vstup do souboje", 409);
              if (fight.entity.hp <= 0 || p.hp <= 0) throw new ClientError("Souboj skončil", 409);
              const active = [...fight.members.keys()].filter((id) => {
                const other = this.players.get(`${id}:${p.session.mode}`);
                return (
                  other?.position &&
                  this.now() - other.positionAt < 30000 &&
                  distance(other.position, entity) < 90
                );
              });
              if (entity.kind === "boss" && active.length < 2)
                throw new ClientError("Raid potřebuje alespoň dva hráče u portálu", 409);
              const spell = action.type === "cast";
              if (this.now() < (spell ? p.castReadyAt : p.shootReadyAt))
                throw new ClientError("Schopnost se obnovuje", 409);
              if (spell) p.castReadyAt = this.now() + 4500;
              else p.shootReadyAt = this.now() + 500;
              const weaponLevel =
                (await this.progress(userId, p.session.mode, tx)).weaponLevel ?? 0;
              const damage = (spell ? 35 : 12) + weaponLevel * (spell ? 4 : 2);
              // Splash only affects encounters this player deliberately joined.
              const targets = spell
                ? [...this.fights.values()].filter(
                    (candidate) =>
                      candidate.mode === p.session.mode &&
                      candidate.entity.hp > 0 &&
                      candidate.members.has(userId) &&
                      distance(candidate.entity, entity) <= 15 &&
                      distance(candidate.entity, p.position!) <=
                        (candidate.entity.kind === "boss" ? 90 : 70)
                  )
                : [fight];
              for (const target of targets) {
                const eligible = [...target.members.keys()].filter((id) => {
                  const participant = this.players.get(`${id}:${p.session.mode}`);
                  return (
                    participant?.position &&
                    participant.hp > 0 &&
                    this.now() - participant.positionAt < 30000 &&
                    distance(participant.position, target.entity) < 90
                  );
                });
                if (target.entity.kind === "boss" && eligible.length < 2) continue;
                const nextHp = Math.max(0, target.entity.hp - damage);
                const member = target.members.get(userId)!;
                member.hits++;
                member.lastHit = this.now();
                if (nextHp === 0) {
                  for (const [id, stats] of target.members) {
                    const participant = this.players.get(`${id}:${p.session.mode}`);
                    if (participant && stats.hits > 0 && eligible.includes(id))
                      await this.reward(
                        tx,
                        participant,
                        target.entity.id,
                        target.entity.kind === "boss" ? WORLD_REWARDS.raid : WORLD_REWARDS.enemy,
                        target.entity.kind === "boss" ? "Relikvie portálu" : "Úlomek strážce",
                        target.entity.kind === "boss" ? "Strážce poražen" : undefined
                      );
                  }
                  await tx.put("raid_results", {
                    id: target.entity.id,
                    mode: p.session.mode,
                    createdAt: this.now(),
                    finished: true
                  });
                }
                target.entity.hp = nextHp;
                target.entity.phase = nextHp < target.entity.maxHp / 2 ? 2 : 1;
                target.updatedAt = this.now();
              }
            }
          }
          await tx.put("actions", {
            id: receiptId,
            userId,
            mode: p.session.mode,
            fingerprint,
            createdAt: this.now()
          });
        });
      } catch (error) {
        this.fights = previousFights;
        Object.assign(p, previousPlayer);
        throw error;
      } finally {
        this.mutating = false;
      }
      return this.snapshot(userId, sessionId);
    });
  }
  /** 10Hz authority tick. Damage never comes from a browser-reported collision. */
  tick() {
    if (this.mutating) return;
    this.prune();
    for (const fight of this.fights.values()) {
      if (fight.entity.hp <= 0) continue;
      for (const [id, member] of fight.members) {
        const p = this.players.get(`${id}:${fight.mode}`);
        if (
          !p?.position ||
          this.now() - p.positionAt > 30000 ||
          distance(p.position, fight.entity) > 90
        ) {
          fight.members.delete(id);
          fight.entity.participants = fight.members.size;
          continue;
        }
        if (this.now() >= member.nextAttack) {
          p.hp = Math.max(
            0,
            p.hp - (fight.entity.kind === "boss" ? (fight.entity.phase === 2 ? 9 : 6) : 3)
          );
          member.nextAttack = this.now() + (fight.entity.phase === 2 ? 2000 : 2500);
        }
      }
    }
  }
  async createQuest(userId: string, sessionId: string, input: Record<string, unknown>) {
    const p = this.player(userId, sessionId),
      at = point(input);
    const kind = input.kind;
    if (!["visit", "cache", "trail"].includes(String(kind)))
      throw new ClientError("Neplatný druh questu");
    const answer = kind === "cache" ? text(input.answer, 200) : "";
    const checkpoints =
      kind === "trail" && Array.isArray(input.checkpoints) ? input.checkpoints.map(point) : [];
    if (kind === "trail" && (checkpoints.length < 2 || checkpoints.length > 8))
      throw new ClientError("Trasa potřebuje 2–8 bodů");
    const startsAt = Number(input.startsAt ?? this.now()),
      endsAt = Number(input.endsAt ?? this.now() + 7 * 86400000);
    if (
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= Math.max(startsAt, this.now()) ||
      endsAt - this.now() > 90 * 86400000
    )
      throw new ClientError("Neplatné časové okno");
    const id = randomUUID();
    const quest: StoredQuest = {
      id,
      ...at,
      ownerId: userId,
      title: text(input.title, 100),
      description: text(input.description, 1600),
      kind: kind as StoredQuest["kind"],
      hint: typeof input.hint === "string" ? input.hint.slice(0, 500) : "",
      radiusM: 30,
      xp: kind === "visit" ? 50 : 100,
      checkpoints,
      startsAt,
      endsAt,
      answerHash: answer ? this.answerHash(id, answer) : "",
      mode: p.session.mode
    };
    const actionId = text(input.actionId ?? randomUUID(), 100),
      receiptId = `create-quest:${p.session.mode}:${userId}:${actionId}`;
    const { sessionId: _session, ...payload } = input;
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return this.repository.transaction(async (tx) => {
      const receipt = await tx.get<{ resourceId: string; fingerprint: string }>(
        "actions",
        receiptId
      );
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ClientError("Identifikátor questu už byl použit", 409);
        return { id: receipt.resourceId };
      }
      await tx.put("quests", { ...record(quest), createdAt: this.stamp() });
      await tx.put("actions", {
        id: receiptId,
        userId,
        mode: p.session.mode,
        resourceId: id,
        fingerprint,
        createdAt: this.stamp()
      });
      return { id };
    });
  }
  private answerHash(id: string, answer: string) {
    return createHash("sha256")
      .update(`${id}:${answer.trim().normalize("NFKC").toLocaleLowerCase("cs")}`)
      .digest("hex");
  }
  private async completeQuest(
    p: LivePlayer,
    id: string,
    answer: string | undefined,
    tx: WorldRepository,
    externalVerified = false
  ) {
    if (id.startsWith("external:")) {
      if (!externalVerified) throw new ClientError("Přibliž se k ověřenému cíli questu", 409);
      await this.reward(tx, p, id, WORLD_REWARDS.visit, null);
      return;
    }
    const quest = await tx.get<StoredQuest>("quests", id);
    if (!quest || quest.mode !== p.session.mode) throw new ClientError("Quest nebyl nalezen", 404);
    if (this.now() < quest.startsAt || this.now() > quest.endsAt)
      throw new ClientError("Quest není aktivní", 409);
    {
      const progress = await this.progress(p.userId, p.session.mode, tx);
      if (progress.completed.includes(id)) return;
      const checkpoint = progress.checkpoints[id] ?? 0;
      const target = quest.kind === "trail" ? quest.checkpoints[checkpoint]! : quest;
      if (distance(this.ready(p), target) > quest.radiusM)
        throw new ClientError("Nejsi u cíle questu", 409);
      if (
        quest.kind === "cache" &&
        !timingSafeEqual(
          Buffer.from(quest.answerHash, "hex"),
          Buffer.from(this.answerHash(id, text(answer, 200)), "hex")
        )
      )
        throw new ClientError("Odpověď nesouhlasí", 409);
      if (quest.kind === "trail" && checkpoint + 1 < quest.checkpoints.length) {
        progress.checkpoints[id] = checkpoint + 1;
        await tx.put("profiles", record(progress));
        return;
      }
      await this.reward(tx, p, id, quest.xp, null);
    }
  }
}
