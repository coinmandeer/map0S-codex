import { expect, test } from "./fixtures/offlineTest";

test.describe("dlouhý herní výkon", () => {
  test.skip(
    process.env.MAPOS_LONG_PERF !== "1",
    "Pětiminutový smoke se spouští cíleně před nasazením."
  );

  test("pět minut pohybu a přepínání nevytvoří druhý loop ani únik scény", async ({ page }) => {
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/?mode=game&lng=13.3775&lat=49.7475&z=16");
    await page.waitForFunction(() => Boolean(window.render_game_to_text), null, {
      timeout: 20_000
    });
    await expect
      .poll(() => page.evaluate(() => window.__maposGame?.contents.orbs ?? 0))
      .toBeGreaterThan(0);

    const startedAt = Date.now();
    let nextSwitchAt = 30_000;
    const heapSamples: number[] = [];
    let direction: "ArrowLeft" | "ArrowRight" = "ArrowRight";

    while (Date.now() - startedAt < 300_000) {
      await page.keyboard.down(direction);
      await page.waitForTimeout(120);
      await page.keyboard.up(direction);
      direction = direction === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
      await page.waitForTimeout(730);

      const elapsed = Date.now() - startedAt;
      if (elapsed >= nextSwitchAt) {
        const snapshot = await page.evaluate(() =>
          JSON.parse(window.render_game_to_text?.() ?? "null")
        );
        expect(snapshot.host.avatarOwners).toBe(1);
        expect(snapshot.host.renderLoops).toBe(1);

        await page.getByTestId("mode-planning").click();
        await expect.poll(() => page.evaluate(() => Boolean(window.__maposGame))).toBe(false);
        await page.getByTestId("mode-game").click();
        await page.waitForFunction(() => Boolean(window.render_game_to_text), null, {
          timeout: 20_000
        });
        nextSwitchAt += 30_000;
      }

      if (elapsed > 20_000 && elapsed % 10_000 < 900) {
        const heap = await page.evaluate(() => {
          const extended = performance as Performance & {
            memory?: { usedJSHeapSize: number };
          };
          return extended.memory?.usedJSHeapSize ?? null;
        });
        if (heap != null) heapSamples.push(heap);
      }
    }

    const finalState = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    expect(finalState.host.avatarOwners).toBe(1);
    expect(finalState.host.renderLoops).toBe(1);
    expect(finalState.counts.hasPlayer).toBe(true);
    expect(finalState.counts.orbs).toBeGreaterThan(0);
    expect(errors).toEqual([]);

    if (heapSamples.length >= 2) {
      expect(heapSamples.at(-1)! - heapSamples[0]!).toBeLessThan(96 * 1024 * 1024);
    }

    await page.getByTestId("mode-planning").click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          scene: Boolean(window.__maposGame),
          loopBridge: Boolean(window.advanceTime),
          layer: Boolean(window.__maposMap?.getLayer("custom-gl-game"))
        }))
      )
      .toEqual({ scene: false, loopBridge: false, layer: false });
  });
});
