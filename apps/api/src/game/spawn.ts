/** Deterministic world spawning — the single source of truth for where ghosts and encounters
 *  are, shared by the Postgres-backed service, the in-memory dev server and the tests.
 *
 *  Nothing here touches a database. Given a cell and a time bucket, every caller derives the
 *  same entities, which is what makes three things work at once:
 *  - the game is playable anywhere in Europe without seeding a single row;
 *  - `memory-server` has real parity with production instead of returning empty stubs;
 *  - the world "moves on" every 30 minutes without a scheduler.
 *
 *  Persistence is only ever needed for *mutations* (who caught what) — never for existence.
 */

import type { Bbox } from "@mapos/layer-sdk";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";

export const GHOST_CELL_ZOOM = 12;
export const GHOSTS_PER_CELL = 3;
export const ENCOUNTER_CELL_ZOOM = 11;
export const RESPAWN_WINDOW_MS = 30 * 60_000;

/** Placeholder token-id pool standing in for a real Aavegotchi subgraph query — keeps the
 *  ghost layer fully playable offline while still rendering real Aavegotchi SVGs client-side. */
const GOTCHI_POOL_SIZE = 200;

export const ENCOUNTER_MODELS = ["goblin", "wolf", "demon", "giant", "chicken"] as const;
export type EncounterKind = (typeof ENCOUNTER_MODELS)[number];
export type LootTier = "low" | "medium" | "high";

export interface SpawnedGhost {
  id: string;
  cellId: string;
  lng: number;
  lat: number;
  gotchiId: string;
}

export interface SpawnedEncounter {
  id: string;
  cellId: string;
  lng: number;
  lat: number;
  templateKind: EncounterKind;
  lootTier: LootTier;
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function currentTimeBucket(now = Date.now()): number {
  return Math.floor(now / RESPAWN_WINDOW_MS);
}

/** Ids travel as URL path params (`/game/ghosts/:id/catch`), so they must not contain the
 *  slashes of `cellId` — those would make the route 404. */
function cellToken(cell: Cell): string {
  return `${cell.z}_${cell.x}_${cell.y}`;
}

export function ghostsForCell(cell: Cell, timeBucket: number): SpawnedGhost[] {
  const cId = cellId(cell);
  const [w, s, e, n] = cellBounds(cell);
  const rand = mulberry32(hashString(`${cId}:${timeBucket}`));
  return Array.from({ length: GHOSTS_PER_CELL }, (_, i) => ({
    id: `ghost-${cellToken(cell)}-${timeBucket}-${i}`,
    cellId: cId,
    lng: w + rand() * (e - w),
    lat: s + rand() * (n - s),
    gotchiId: String(Math.floor(rand() * GOTCHI_POOL_SIZE))
  }));
}

/** Encounters were previously tied to seeded `game_zones`, which meant an empty database — or
 *  anywhere outside the seeded Czech zones — had no encounters at all. Deriving them per cell
 *  instead makes the whole continent playable, while zone-bound encounters still exist for
 *  curated, staking-gated locations. */
export function encountersForCell(cell: Cell, timeBucket: number): SpawnedEncounter[] {
  const cId = cellId(cell);
  const rand = mulberry32(hashString(`enc:${cId}:${timeBucket}`));

  // Roughly two thirds of cells hold one encounter. Sparser than ghosts on purpose: an
  // encounter is a stop-and-fight beat, not scenery.
  if (rand() > 0.66) return [];

  const [w, s, e, n] = cellBounds(cell);
  const roll = rand();
  const lootTier: LootTier = roll > 0.9 ? "high" : roll > 0.6 ? "medium" : "low";
  return [
    {
      id: `enc-${cellToken(cell)}-${timeBucket}`,
      cellId: cId,
      lng: w + rand() * (e - w),
      lat: s + rand() * (n - s),
      templateKind: ENCOUNTER_MODELS[Math.floor(rand() * ENCOUNTER_MODELS.length)]!,
      lootTier
    }
  ];
}

export function ghostsForBbox(bbox: Bbox, maxCells = 30, now = Date.now()): SpawnedGhost[] {
  const bucket = currentTimeBucket(now);
  const [w, s, e, n] = bbox;
  return cellsForBbox(bbox, maxCells, GHOST_CELL_ZOOM)
    .flatMap((cell) => ghostsForCell(cell, bucket))
    .filter((g) => g.lng >= w && g.lng <= e && g.lat >= s && g.lat <= n);
}

export function encountersForBbox(bbox: Bbox, maxCells = 12, now = Date.now()): SpawnedEncounter[] {
  const bucket = currentTimeBucket(now);
  const [w, s, e, n] = bbox;
  return cellsForBbox(bbox, maxCells, ENCOUNTER_CELL_ZOOM)
    .flatMap((cell) => encountersForCell(cell, bucket))
    .filter((enc) => enc.lng >= w && enc.lng <= e && enc.lat >= s && enc.lat <= n);
}

export const REWARD_BY_TIER: Record<LootTier, number> = { low: 0.5, medium: 2, high: 5 };

/** Re-derives a ghost from its id. Because ids encode (cell, time bucket, index), a catch can
 *  be validated without ever having stored the ghost — and a ghost from an expired bucket is
 *  correctly rejected as gone. */
export function ghostById(id: string, now = Date.now()): SpawnedGhost | null {
  const match = id.match(/^ghost-(\d+)_(\d+)_(\d+)-(\d+)-(\d+)$/);
  if (!match) return null;
  const [, z, x, y, bucket, index] = match;
  const timeBucket = Number(bucket);
  if (timeBucket !== currentTimeBucket(now)) return null;
  const ghosts = ghostsForCell({ z: Number(z), x: Number(x), y: Number(y) }, timeBucket);
  return ghosts[Number(index)] ?? null;
}

export function encounterById(id: string, now = Date.now()): SpawnedEncounter | null {
  const match = id.match(/^enc-(\d+)_(\d+)_(\d+)-(\d+)$/);
  if (!match) return null;
  const [, z, x, y, bucket] = match;
  const timeBucket = Number(bucket);
  if (timeBucket !== currentTimeBucket(now)) return null;
  return encountersForCell({ z: Number(z), x: Number(x), y: Number(y) }, timeBucket)[0] ?? null;
}
