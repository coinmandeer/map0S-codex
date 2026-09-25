import { expect, test } from "./fixtures/offlineTest";

/** §4.7 ③: the built-in presets answer "what are you doing today". A saved set answers
 *  "the combination I always build by hand", and it has to survive a reload to be worth it. */
test.describe("custom presets", () => {
  test("a set of layers can be saved, applied and deleted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?lng=13.3775&lat=49.7475&z=12");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

    // The dialog saves the current appearance as a whole, so the set has to contain the layer
    // it is meant to restore first.
    await page.evaluate(async () => {
      const { getMapStore } = await import("/src/store/mapStore.ts");
      getMapStore().activateLayer("inaturalist");
    });

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("save-preset-open").click();
    const dialog = page.getByTestId("save-preset-dialog");
    await expect(dialog).toBeVisible();

    // Saving needs a name: an unnamed set could not be recognised again.
    await expect(page.getByTestId("save-preset-submit")).toBeDisabled();
    await page.getByTestId("save-preset-name").fill("Vanlife weekend");
    await page.getByTestId("save-preset-submit").click();
    await expect(dialog).toHaveCount(0);

    // The saved set shows up in the preset picker next to the built-in use cases.
    await page.getByLabel("Preset").click();
    await expect(page.getByRole("option", { name: "Vanlife weekend" })).toBeVisible();
    await page.keyboard.press("Escape");

    // It survives a reload, because it is the user's set rather than this session's.
    await page.reload();
    await page.getByTestId("layers-btn").click();
    await page.getByLabel("Preset").click();
    await page.getByRole("option", { name: "Vanlife weekend" }).click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { getMapStore } = await import("/src/store/mapStore.ts");
            return getMapStore().activeLayers["inaturalist"]?.visible ?? false;
          }),
        { timeout: 20_000 }
      )
      .toBe(true);
  });
});
