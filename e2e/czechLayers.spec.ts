import { expect, test, type Page } from "./fixtures/offlineTest";
import { catalogResultRow, catalogSwitch } from "./fixtures/mapPanel";

/** Shortcuts are the user's own favourites; nothing is pinned to the top bar by default. */
async function favouriteCadastre(page: Page) {
  await expect(page.getByTestId("quick-layers")).toHaveCount(0);
  await catalogSwitch(page, "cz-cadastre");
  await catalogResultRow(page, "cz-cadastre")
    .first()
    .getByRole("button", { name: /Favorite:|Oblíbené:/ })
    .click();
  await page.getByTestId("layers-search").fill("");
  await page.getByTestId("right-utility-close").click();
  await expect(page.getByTestId("quick-layers").getByTestId(/quick-toggle-/)).toHaveCount(1);
}

test("shortcuts, mixed subgroup, opacity, favorites and restored state share one layer", async ({
  page
}) => {
  await page.goto("/?lng=14.414&lat=50.086&z=18");
  await favouriteCadastre(page);
  const quick = page.getByTestId("quick-toggle-cz-cadastre");
  await expect(quick).toHaveAttribute("aria-pressed", "false");
  await quick.click();
  await page.getByTestId("quick-settings-cz-cadastre").click();
  const rowSwitch = page.getByTestId("czech-land-switch-cz-cadastre");
  await expect(rowSwitch).toBeChecked();
  const group = page.getByTestId("cz-group-switch-cadastre");
  await expect(group).toHaveAttribute("aria-checked", "mixed");
  const slider = page.getByTestId("layer-opacity-cz-cadastre").getByRole("slider");
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "0.05");
  await group.click();
  await expect(group).toHaveAttribute("aria-checked", "true");
  await group.click();
  await expect(group).toHaveAttribute("aria-checked", "false");
  await expect(quick).toHaveAttribute("aria-pressed", "false");
  await rowSwitch.click();
  await expect(quick).toHaveAttribute("aria-pressed", "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  // The favourite is the user's and survives a reload.
  await expect(page.getByTestId("quick-layers").getByTestId(/quick-toggle-/)).toHaveCount(1);
  await page.getByTestId("quick-settings-cz-cadastre").click();
  await expect(page.getByTestId("layer-opacity-cz-cadastre")).toBeVisible();
});

test("small zoom preserves selection, foreign view has no shortcuts and mobile controls fit", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lng=13.4&lat=52.5&z=10");
  await expect(page.getByTestId("quick-layers")).toHaveCount(0);
  await page.goto("/?lng=14.414&lat=50.086&z=9");
  await favouriteCadastre(page);
  await page.getByTestId("quick-toggle-cz-cadastre").click();
  await expect(page.getByTestId("quick-toggle-cz-cadastre")).toContainText(/Zoom in|Přibližte/);
  const buttons = page.getByTestId("quick-layers").getByRole("button");
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId("quick-settings-cz-cadastre").click();
  await expect(page.getByTestId("settings-czech-land-cz-cadastre")).toBeVisible();
  await expect(page.getByTestId("cz-group-switch-cadastre")).toHaveAttribute(
    "aria-checked",
    "mixed"
  );
});
