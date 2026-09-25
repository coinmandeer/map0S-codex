import { expect, type Page } from "@playwright/test";

/**
 * An empty plan is the A→B form; the editor (name, stops, options, AI) appears once two stops are
 * chosen. Picking GPS pairs keeps the plan independent of any geocoder.
 */
export async function createInitialPlan(page: Page) {
  if (await page.getByTestId("plan-name").count()) return;
  for (const [index, coordinates] of [
    [1, "49.7475, 13.3775"],
    [2, "49.7575, 13.3975"]
  ] as const) {
    await page.getByLabel(`Název zastávky ${index}`, { exact: true }).fill(coordinates);
    await page.getByRole("option", { name: /Použít GPS/ }).click();
  }
  await expect(page.getByTestId("plan-name")).toBeVisible();
  await page.getByLabel("Název zastávky 1", { exact: true }).fill("Start");
  await page.getByLabel("Název zastávky 2", { exact: true }).fill("Cíl");
  await page.getByTestId("plan-name").focus();
}

/** Share, export and hand-off are three icons opening one tabbed dialog (§29.3). */
export async function openShareDialog(page: Page, tab: "share" | "export" | "handoff") {
  const trigger = {
    share: "open-plan-share",
    export: "open-plan-export",
    handoff: "open-plan-handoff"
  }[tab];
  await page.getByTestId(trigger).click();
  await expect(page.getByTestId("plan-share-dialog")).toBeVisible();
  await expect(page.getByTestId(`plan-share-tabs-${tab}`)).toHaveAttribute("aria-selected", "true");
}

/** Escape reaches the panel shell and closes the whole panel, so overlays are dismissed
 *  through their own close button. */
export async function closeShareDialog(page: Page) {
  const dialog = page.getByTestId("plan-share-dialog");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
}
