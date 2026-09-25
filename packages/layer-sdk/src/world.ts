/** MapOS game/social wire contracts. Private GPS and wallet identity never belong to Presence. */
export interface WorldPosition {
  lng: number;
  lat: number;
}
export type WorldMode = "gps" | "test" | "explore";
export interface WorldProfile {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}
export interface GameSession {
  id: string;
  mode: WorldMode;
  avatarTokenId: string | null;
  expiresAt: number;
}
export type WorldEntityKind = "essence" | "chest" | "lickquidator" | "boss" | "portal" | "coin";
export interface WorldEntity extends WorldPosition {
  id: string;
  kind: WorldEntityKind;
  name: string;
  variant: number;
  hp: number;
  maxHp: number;
  engaged: boolean;
  phase: number;
  participants: number;
}
export interface RewardGrant {
  id: string;
  userId: string;
  mode: WorldMode;
  sourceId: string;
  xp: number;
  item: string | null;
  at: number;
}
export interface WorldProgress {
  xp: number;
  level: number;
  items: Record<string, number>;
  badges: string[];
  /** Street coins picked up; part of the profile so the count survives the session. */
  coins?: number;
  /** Persistent, mode-scoped weapon training (0–5). */
  weaponLevel?: number;
}
export interface GameQuest extends WorldPosition {
  sourceUrl?: string;
  sourceLabel?: string;
  id: string;
  title: string;
  description: string;
  kind: "visit" | "cache" | "trail" | "raid" | "combat";
  radiusM: number;
  xp: number;
  hint: string;
  checkpoints: WorldPosition[];
  startsAt: number;
  endsAt: number;
  completed: boolean;
  checkpoint: number;
  ownerId: string;
}
export type GameAction =
  | {
      type: "collect" | "engage" | "shoot" | "cast" | "upgrade";
      targetId: string;
      actionId: string;
    }
  | { type: "quest"; targetId: string; actionId: string; answer?: string };
/** A gameplay zone with a countdown. Zones are derived deterministically per cell, so every
 *  player looking at the same street sees the same ring and the same clock. */
export interface WorldZoneSummary extends WorldPosition {
  id: string;
  name: string;
  zoneKind: "standard" | "event" | "staker_gate";
  radiusM: number;
  lifecycle: "active" | "scheduled" | "expired";
  /** Seconds until the window opens (only for a scheduled zone). */
  startsInSeconds: number | null;
  /** Seconds until the window closes (only for an active zone). */
  endsInSeconds: number | null;
}
export interface WorldSnapshot {
  physicalPosition: (WorldPosition & { accuracy: number; observedAt: number }) | null;
  gamePosition: WorldPosition | null;
  arena: {
    entityId: string;
    participants: { id: string; position: WorldPosition; self: boolean }[];
  } | null;
  session: GameSession;
  serverTime: number;
  positionReady: boolean;
  position: WorldPosition | null;
  hp: number;
  maxHp: number;
  shootReadyAt: number;
  castReadyAt: number;
  entities: WorldEntity[];
  quests: GameQuest[];
  /** Countdown zones around the player; the client draws the rings and the clock. */
  zones: WorldZoneSummary[];
  progress: WorldProgress;
}
export interface PublicPresence extends WorldPosition {
  presenceId: string;
  label: string;
  approximate: boolean;
  avatarTokenId?: string;
  model?: GotchiModel;
  profile?: WorldProfile;
  checkIn?: { title: string; expiresAt: number };
}
export interface ContactRequest {
  id: string;
  from: string;
  to: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
}
export interface ContactView extends ContactRequest {
  profile: WorldProfile;
  incoming: boolean;
  favorite: boolean;
  unread: number;
}
export type MessageOrigin = "nearby" | "remote" | "unknown";
export interface GeoThread extends WorldPosition {
  id: string;
  author: WorldProfile;
  title: string;
  body: string;
  kind: "trollbox" | "place";
  origin: MessageOrigin;
  createdAt: number;
  updatedAt: number;
  closed: boolean;
  replies: number;
  placeId?: string;
}
export interface Conversation {
  id: string;
  participantIds: [string, string];
  encryption: "transport";
}
export interface WorldMessage {
  id: string;
  threadId: string;
  author: WorldProfile;
  body: string;
  createdAt: number;
}
export interface WorldPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface GotchiModel {
  tokenId: string;
  status: "ready" | "pending" | "unavailable";
  notice: string;
  url?: string;
  appearanceHash?: string;
  lods?: {
    level: "high" | "low";
    url: string;
    bytes: number;
    triangles: number;
    drawCalls: number;
    textureBytes: number;
  }[];
}
export const WORLD_REWARDS = {
  essence: 10,
  coin: 5,
  enemy: 25,
  visit: 50,
  cache: 100,
  trail: 100,
  raid: 150
} as const;
export const TROLLBOX_RADII = [100, 500, 1000, 10000, 20000, 50000] as const;

export const AAVEGOTCHI_BASE_DIAMOND = "0xa99c4b08201f2913db8d28e71d020c4298f29dbf" as const;
