import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { gameProfiles } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import { getGameProgress } from "./gameProgressService.js";

const GAME_IDS = new Set(["aavegotchi", "trail-signals"]);

function cleanGameId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!GAME_IDS.has(id)) throw new ClientError("Neznámá hra");
  return id;
}

function cleanPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ClientError("Neplatný herní stav");
  const encoded = JSON.stringify(value);
  if (encoded.length > 64_000) throw new ClientError("Herní stav je příliš velký");
  return JSON.parse(encoded) as Record<string, unknown>;
}

export async function getNamespacedGameState(userId: string, inputGameId: unknown) {
  const gameId = cleanGameId(inputGameId);
  const [row] = await db
    .select()
    .from(gameProfiles)
    .where(and(eq(gameProfiles.userId, userId), eq(gameProfiles.gameId, gameId)))
    .limit(1);
  if (row) return { gameId, state: row.payload, updatedAt: row.updatedAt.toISOString() };

  const state: Record<string, unknown> =
    gameId === "aavegotchi" ? await getGameProgress(userId) : {};
  const [created] = await db
    .insert(gameProfiles)
    .values({ userId, gameId, payload: state })
    .onConflictDoNothing()
    .returning();
  return { gameId, state, updatedAt: created?.updatedAt.toISOString() ?? new Date().toISOString() };
}

export async function patchNamespacedGameState(
  userId: string,
  inputGameId: unknown,
  patch: unknown
) {
  const gameId = cleanGameId(inputGameId);
  const values = cleanPayload(patch);
  const current = await getNamespacedGameState(userId, gameId);
  const state = { ...current.state, ...values };
  const [row] = await db
    .insert(gameProfiles)
    .values({ userId, gameId, payload: state })
    .onConflictDoUpdate({
      target: [gameProfiles.userId, gameProfiles.gameId],
      set: { payload: state, updatedAt: new Date() }
    })
    .returning();
  return { gameId, state: row!.payload, updatedAt: row!.updatedAt.toISOString() };
}
