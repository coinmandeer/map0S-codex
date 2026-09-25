import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The map panel as a user reaches it: the "Layers" button on the right rail opens one drawer with
 * two tabs, layers and basemaps. Specs used to click separate `basemap-btn` / overflow buttons
 * that the redesign folded into this drawer; these helpers are the one place that knows the way
 * in, so the next change to the chrome is a one-file change here.
 */
export async function openLayersPanel(page: Page): Promise<void> {
  if (!(await page.getByTestId("overflow-menu").isVisible())) {
    if (!(await page.getByTestId("right-utility-drawer").isVisible()))
      await page.getByTestId("layers-btn").click();
    await page.getByTestId("map-panel-tab-layers").click();
  }
  await expect(page.getByTestId("overflow-menu")).toBeVisible();
}

export async function openBasemaps(page: Page): Promise<void> {
  if (!(await page.getByTestId("right-utility-drawer").isVisible()))
    await page.getByTestId("layers-btn").click();
  await page.getByTestId("map-panel-tab-basemaps").click();
  await expect(page.getByTestId("tiles-sheet")).toBeVisible();
}

/**
 * The switch of one catalogue row, found through the panel's own search by its layer id. A layer
 * shared by several rows (trails by activity, infrastructure by network, observations by taxon)
 * is searched by the layer and picked by the row's own id.
 */
export async function catalogSwitch(
  page: Page,
  layerId: string,
  itemId = layerId
): Promise<Locator> {
  await openLayersPanel(page);
  await page.getByTestId("layers-search").fill(layerId);
  const toggle = page
    .getByTestId("layers-results")
    .locator(`[data-testid$="-switch-${itemId}"]`)
    .first();
  await expect(toggle).toBeVisible();
  return toggle;
}

/** The row of one catalogue layer in the search results, for its settings button and status. */
export function catalogResultRow(page: Page, itemId: string): Locator {
  return page.getByTestId("layers-results").locator(`.catalog-item[data-testid$="-${itemId}"]`);
}

/** Opens a catalogue row's settings (filters, opacity, sources) from the search results. */
export async function openCatalogSettings(
  page: Page,
  layerId: string,
  itemId = layerId
): Promise<Locator> {
  await catalogSwitch(page, layerId, itemId);
  const row = catalogResultRow(page, itemId).first();
  await row.locator('[data-testid^="catalog-settings-btn-"]').click();
  const settings = row.locator('[data-testid^="settings-"]');
  await expect(settings).toBeVisible();
  return settings;
}

/** A layer the user added, found by the name they gave it (its id is minted by the server). */
export async function namedLayerSwitch(page: Page, name: string): Promise<Locator> {
  await openLayersPanel(page);
  await page.getByTestId("layers-search").fill(name);
  const toggle = page.getByTestId("overflow-menu").getByRole("switch", { name });
  await expect(toggle).toBeVisible();
  return toggle;
}
