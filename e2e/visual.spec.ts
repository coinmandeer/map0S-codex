import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const DIR = "e2e/screenshots";

test.describe("visual snapshots", () => {
  test("capture header, megamenu, discover, game at 1440/768/390", async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(DIR, { recursive: true });
    await page.route("**/game/zones", (route) =>
      route.fulfill({ json: { zones: [], quests: [] } })
    );
    await page.route("**/game/ghosts**", (route) => route.fulfill({ json: { ghosts: [] } }));
    await page.route("**/game/encounters**", (route) =>
      route.fulfill({ json: { encounters: [] } })
    );

    for (const width of [1440, 768, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/");
      await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });
      await page.screenshot({ path: `${DIR}/${width}-default.png`, fullPage: true });

      await page.getByTestId("overflow-btn").click();
      await page.getByTestId("overflow-menu").waitFor();
      await page.screenshot({ path: `${DIR}/${width}-megamenu.png`, fullPage: true });
      await page.keyboard.press("Escape");

      const mobile = width < 900;
      if (mobile) {
        await page.getByTestId("bottom-nav").getByTestId("mode-discover").click();
      } else {
        await page.getByTestId("mode-bar").getByTestId("mode-discover").click();
      }
      await page.getByTestId("discover-panel").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/${width}-discover.png`, fullPage: true });
      // Reached by URL rather than by clicking through: the Discover panel's overlay sits over
      // the nav it would have to click, and this screenshot is about the game screen, not about
      // how you get there.
      await page.goto("/?mode=game");
      await page.getByTestId("game-hud").waitFor({ timeout: 30_000 });
      await page.screenshot({ path: `${DIR}/${width}-game.png`, fullPage: true });
    }
  });
});
