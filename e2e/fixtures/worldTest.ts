import type { GameAction, GameSession, WorldPosition, WorldSnapshot } from "@mapos/layer-sdk";
import { expect, type Page } from "./offlineTest";

export async function worldRequest<T>(page: Page, path: string, body: object): Promise<T> {
  const result = await page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(`/api/v2/world/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body }
  );
  expect(result.status, `World ${path}: ${JSON.stringify(result.body)}`).toBe(200);
  return result.body as T;
}

export async function startExplore(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user?.id))
    .toBeTruthy();
  const session = await worldRequest<GameSession>(page, "session", { mode: "explore" });
  await positionWorld(page, session.id, { lng: 13.3775, lat: 49.7475 });
  return session;
}

export const positionWorld = (page: Page, sessionId: string, position: WorldPosition) =>
  worldRequest(page, "position", {
    sessionId,
    position: { lng: position.lng, lat: position.lat },
    accuracy: 0,
    observedAt: Date.now()
  });
export const snapshotWorld = (page: Page, sessionId: string) =>
  worldRequest<WorldSnapshot>(page, "snapshot", { sessionId });
export const actWorld = (page: Page, sessionId: string, action: GameAction) =>
  worldRequest<WorldSnapshot>(page, "action", { sessionId, action });

export async function collectEssence(page: Page, sessionId: string) {
  const before = await snapshotWorld(page, sessionId);
  const target = before.entities.find((entity) => entity.kind === "essence");
  expect(target).toBeTruthy();
  await positionWorld(page, sessionId, target!);
  const action: GameAction = {
    type: "collect",
    targetId: target!.id,
    actionId: crypto.randomUUID()
  };
  const after = await actWorld(page, sessionId, action);
  expect(after.progress.xp).toBeGreaterThan(before.progress.xp);
  const replay = await actWorld(page, sessionId, action);
  expect(replay.progress).toEqual(after.progress);
  return after;
}

export async function winSoloFight(page: Page, sessionId: string) {
  let snapshot = await snapshotWorld(page, sessionId);
  const quest = snapshot.quests.find((item) => item.kind === "combat" && !item.completed);
  expect(quest).toBeTruthy();
  await positionWorld(page, sessionId, quest!);
  snapshot = await actWorld(page, sessionId, {
    type: "engage",
    targetId: quest!.id,
    actionId: crypto.randomUUID()
  });
  const previousXp = snapshot.progress.xp;
  for (let hit = 0; hit < 8 && snapshot.progress.xp === previousXp; hit++) {
    // Honor the real server cooldown; no clock override or legacy reward endpoint.
    await page.waitForTimeout(Math.max(0, snapshot.shootReadyAt - snapshot.serverTime) + 30);
    snapshot = await actWorld(page, sessionId, {
      type: "shoot",
      targetId: quest!.id,
      actionId: crypto.randomUUID()
    });
  }
  expect(snapshot.progress.xp).toBeGreaterThan(previousXp);
  return snapshot;
}
