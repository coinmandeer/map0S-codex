import { test, expect } from "@playwright/test";

/** Unlike the smoke test, these run against the real memory server so the deterministic spawner,
 *  the guest auto-login and the quest loop are all exercised end to end. */
test.describe("Hra", () => {
  test("guest players get ghosts and quests without ever logging in", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/");
    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });

    const ghosts = await page.evaluate(async () => {
      const res = await fetch("http://localhost:4033/game/ghosts?bbox=14.35,50.05,14.5,50.12");
      return ((await res.json()) as { ghosts: unknown[] }).ghosts.length;
    });
    expect(ghosts).toBeGreaterThan(0);

    await expect(page.getByTestId("orb-count")).toBeVisible();
    expect(pageErrors).toHaveLength(0);
  });

  test("a quest can be claimed once and then reads as done", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });

    const quest = page.getByTestId("quest-q1");
    await expect(quest).toBeVisible({ timeout: 15_000 });

    if (await quest.isDisabled()) return; // already claimed by an earlier run against the same server

    await quest.click();
    await expect(page.getByTestId("toast")).toContainText("XP");
    await expect(quest).toContainText("hotovo");
    await expect(quest).toBeDisabled();
  });

  test("catching a ghost removes it from the world for this player", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const base = "http://localhost:4033";
      const bbox = "bbox=14.35,50.05,14.5,50.12";
      await fetch(`${base}/auth/guest`, { method: "POST", credentials: "include" });

      const list = async () =>
        (
          (await (
            await fetch(`${base}/game/ghosts?${bbox}`, { credentials: "include" })
          ).json()) as {
            ghosts: { id: string }[];
          }
        ).ghosts;

      const before = await list();
      const target = before[0]!.id;
      const caught = await fetch(`${base}/game/ghosts/${target}/catch`, {
        method: "POST",
        credentials: "include"
      });
      const again = await fetch(`${base}/game/ghosts/${target}/catch`, {
        method: "POST",
        credentials: "include"
      });
      const after = await list();
      return {
        catchStatus: caught.status,
        repeatStatus: again.status,
        stillThere: after.some((g) => g.id === target)
      };
    });

    expect(result.catchStatus).toBe(200);
    expect(result.repeatStatus).not.toBe(200);
    expect(result.stillThere).toBe(false);
  });
});
