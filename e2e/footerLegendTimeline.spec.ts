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
    await expect(timeline.locator(".timeline-head-label")).toContainText("Weather");
    // One heading, then the cursor: never three levels of title.
    await expect(timeline.locator("h2, h3")).toHaveCount(0);
    await expect(page.getByTestId("timeline-scrubber")).toBeVisible();
  });

  test("play advances the cursor and Live puts it back on now", async ({ page }) => {
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
    await expect(page.getByTestId("global-timeline")).toContainText("Now");
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

  // §6.6 wave A: the six structural overlays draw coloured lines over the basemap, and until
  // now none of them said what the colours meant. They are registered the v1 way, so this also
  // covers the legend reaching the footer through the v1 → v2 adapter.
  for (const overlay of [
    { id: "cyclosm", legendTitle: "CyclOSM", item: "Stezka jen pro kola" },
    { id: "waymarked-trails", legendTitle: "Značené trasy", item: "Mezinárodní trasa" },
    { id: "openrailwaymap", legendTitle: "Železnice", item: "Hlavní trať" },
    { id: "openseamap", legendTitle: "Námořní značení", item: "Maják" },
    { id: "opentopomap", legendTitle: "Topografická", item: "Vrstevnice" },
    { id: "opensnowmap", legendTitle: "Sjezdovky a běžky", item: "Běžecká stopa" }
  ]) {
    test(`the ${overlay.id} overlay explains its colours`, async ({ page }) => {
      await page.goto(`/?layers=${overlay.id}&lng=13.3775&lat=49.7475&z=10`);
      await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

      const legend = page.getByTestId("legend-stack");
      await expect(legend).toBeVisible({ timeout: 20_000 });
      await expect(legend).toContainText(overlay.legendTitle);

      // The compact row is the summary; the entries are behind the same expand as every other
      // legend, so a six-item key never takes the map's room by default.
      const expand = page.getByTestId("legend-expand");
      if (await expand.count()) await expand.click();
      await expect(legend).toContainText(overlay.item);
    });
  }

  test("geology names the dimension its colours encode, not a false swatch", async ({ page }) => {
    await page.goto("/?layers=geology&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

    const legend = page.getByTestId("legend-stack");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    // Macrostrat hands each polygon the colour its own survey chose, so the honest legend says
    // colour means age and admits the shade varies.
    await expect(legend).toContainText("barva je věk");
    const expand = page.getByTestId("legend-expand");
    if (await expand.count()) await expand.click();
    await expect(legend).toContainText("Mezozoikum");
    await expect(legend).toContainText("Odstín se liší podle služby");
  });

  // Rolling a tray up is not the same as turning the layer off: the colours stay on the map,
  // only the key that explains them steps aside, and it says where it went.
  test("a legend rolls up into a chip and comes back from it", async ({ page }) => {
    await page.goto("/?layers=earthquakes&lng=13.3775&lat=49.7475&z=6");
    await expect(page.getByTestId("legend-stack")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("footer-minimize-legend").click();
    await expect(page.getByTestId("legend-stack")).toHaveCount(0);
    const chip = page.getByTestId("footer-restore-legend");
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(page.getByTestId("legend-stack")).toBeVisible();
    await expect(page.getByTestId("footer-restore-legend")).toHaveCount(0);
  });

  test("the timeline rolls up the same way and keeps running underneath", async ({ page }) => {
    await page.goto("/?layers=weather&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("timeline-scrubber")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("footer-minimize-timeline").click();
    await expect(page.getByTestId("global-timeline")).toHaveCount(0);
    await page.getByTestId("footer-restore-timeline").click();
    await expect(page.getByTestId("timeline-scrubber")).toBeVisible();
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
