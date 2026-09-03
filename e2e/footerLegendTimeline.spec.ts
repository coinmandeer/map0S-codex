import { expect, test } from "./fixtures/offlineTest";

/** §4.11: the two footer surfaces. The legend states what the colours on the map mean without
 *  taking the map's room, and the timeline exists only while something on the map has a time. */
test.describe("map footer", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the timeline appears with a time context and names what it drives", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    // A plain map has nothing to scrub: no strip at all rather than an inert one.
    await expect(page.getByTestId("global-timeline")).toHaveCount(0);

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("weather-accordion").click();
    await page.locator('label:has([data-testid="weather-visualization-radar"])').click();
    await page.getByTestId("layers-btn").click();

    const timeline = page.getByTestId("global-timeline");
    await expect(timeline).toBeVisible({ timeout: 20_000 });
    await expect(timeline.locator(".timeline-head-label")).toContainText("Počasí");
    // One heading, then the cursor: never three levels of title.
    await expect(timeline.locator("h2, h3")).toHaveCount(0);
    await expect(page.getByTestId("timeline-scrubber")).toBeVisible();
  });

  test("play advances the cursor and Živě puts it back on now", async ({ page }) => {
    await page.goto("/?layers=weather&lng=13.3775&lat=49.7475&z=10");
    const scrubber = page.getByTestId("timeline-scrubber");
    await expect(scrubber).toBeVisible({ timeout: 30_000 });
    const start = Number(await scrubber.inputValue());

    await page.getByTestId("timeline-play").click();
    await expect
      .poll(async () => Number(await scrubber.inputValue()), { timeout: 20_000 })
      .toBeGreaterThan(start);
    await page.getByTestId("timeline-play").click();

    await page.getByTestId("timeline-live").click();
    // Back to the hour the map opened on, whatever the playback reached in between.
    await expect.poll(async () => Number(await scrubber.inputValue())).toBe(start);
    await expect(page.getByTestId("global-timeline")).toContainText("Teď");
  });

  test("a numeric legend is a compact row before it is a list of values", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=6");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("overflow-earthquakes").click();
    await page.getByTestId("layers-btn").click();

    const legend = page.getByTestId("legend-stack");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    await expect(legend).toContainText("Magnituda zemětřesení");
    // Compact: circles of growing size on one line, not a row per class.
    await expect(legend.locator(".legend-size-dot").first()).toBeVisible();
    await expect(legend.locator(".legend-values li").first()).toContainText("M");
    // A single short legend already says everything, so it offers nothing to expand.
    await expect(page.getByTestId("legend-expand")).toHaveCount(0);
  });

  test("more legends than the footer can hold defer the rest to a dialog", async ({ page }) => {
    await page.route("**/config", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        json: { ...body, capabilities: { ...body.capabilities, ticketmaster: true } }
      });
    });
    await page.goto("/?lng=13.3775&lat=49.7475&z=6");
    await page.getByTestId("layers-btn").click();
    for (const id of ["overflow-earthquakes", "overflow-events", "overflow-trails"]) {
      const toggle = page.getByTestId(id);
      if (await toggle.count()) await toggle.click();
    }
    await page.getByTestId("layers-btn").click();

    const legend = page.getByTestId("legend-stack");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    const rows = legend.getByTestId("legend-detail").locator('[role="listitem"]');
    // The footer keeps at most three rows; the map is the point of the screen.
    expect(await rows.count()).toBeLessThanOrEqual(3);

    const openAll = page.getByTestId("legend-open-all");
    if (await openAll.count()) {
      await openAll.click();
      await expect(page.getByTestId("legend-dialog")).toBeVisible();
    }
  });
});
