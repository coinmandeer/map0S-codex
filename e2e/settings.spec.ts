import { expect, test } from "./fixtures/offlineTest";

test.describe("target Settings drawer", () => {
  test("preferences are functional, typed and persistent", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByTestId("settings-btn").click();

    const settings = page.getByTestId("settings-registry");
    await expect(settings).toBeVisible({ timeout: 45_000 });
    await expect(settings.locator("[data-settings-section]")).toHaveCount(5);

    await page.getByTestId("theme-segmented-dark").click();
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await page.getByTestId("density-segmented-compact").click();
    await expect(page.locator("html")).toHaveClass(/density-compact/);
    await page.getByTestId("low-data-toggle").click();
    await page.getByTestId("units-segmented-imperial").click();
    await expect(settings).toContainText("Miles");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mapos:user-preferences-v1") ?? "null")
    );
    expect(stored).toMatchObject({
      schema: "mapos.user-preferences",
      version: 1,
      preferences: { theme: "dark", density: "compact", units: "imperial", lowData: true }
    });

    await page.reload();
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("low-data-toggle")).toBeChecked();
    await expect(page.getByTestId("theme-segmented-dark")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("density-segmented-compact")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("units-segmented-imperial")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("AI switch removes AI entry points but leaves ordinary search", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    await page.getByTestId("settings-ai-enabled").scrollIntoViewIfNeeded();
    await page.getByTestId("ai-enabled-toggle").click();
    await expect(page.getByTestId("ai-auto-summary-toggle")).toBeDisabled();
    await expect(page.getByTestId("right-utility-close")).toBeVisible();
    await page.getByTestId("right-utility-close").click();

    await expect(page.getByTestId("plan-ai-toggle")).toHaveCount(0);
    const search = page.getByTestId("place-search");
    await search.fill("najdi mi nejbližší bar");
    await expect(page.getByTestId("search-ai-hint")).toHaveCount(0);
    await search.fill("Plzeň");
    await expect(
      page.getByRole("dialog", { name: /Návrhy hledání|Search suggestions/ })
    ).toContainText("MapOS offline geokodér");
    await expect(page.getByTestId("search-ai-hint")).toHaveCount(0);
  });

  test("global Settings no longer duplicates basemaps, providers or game controls", async ({
    page
  }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    const drawer = page.getByTestId("right-utility-drawer");
    await expect(drawer.getByText("Map basemaps", { exact: true })).toHaveCount(0);
    await expect(drawer.getByText("Vyhledávání a trasy", { exact: true })).toHaveCount(0);
    await expect(drawer.getByText("Game", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("settings-active-providers")).toBeVisible();
    await expect(page.getByTestId("settings-data-rights")).toBeVisible();
  });
});
