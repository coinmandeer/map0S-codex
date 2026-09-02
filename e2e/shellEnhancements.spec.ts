import { expect, test } from "./fixtures/offlineTest";

const EMPTY_MAP_STYLE = JSON.stringify({
  version: 8,
  name: "MapOS scenario fixture",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f3f0e8" } }]
});

test.describe("source-grounded shell enhancements", () => {
  test("desktop keeps one optically centred command row above the context panel", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning");

    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);
    await expect(page.getByTestId("planning-panel")).toBeVisible();
    const layout = await page.evaluate(() => {
      const rect = (testId: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.getBoundingClientRect();
      const command = rect("command-center");
      const search = rect("place-search");
      const modes = document.querySelector<HTMLElement>(".mode-tabs")!.getBoundingClientRect();
      const settings = rect("settings-btn");
      const utility = rect("utility-rail");
      const panel = rect("planning-panel");
      return {
        commandCenter: command.left + command.width / 2,
        viewportCenter: innerWidth / 2,
        rowCenters: [
          search.top + search.height / 2,
          modes.top + modes.height / 2,
          settings.top + settings.height / 2
        ],
        commandRight: command.right,
        utilityLeft: utility.left,
        commandBottom: command.bottom,
        panelTop: panel.top
      };
    });
    expect(Math.abs(layout.commandCenter - layout.viewportCenter)).toBeLessThanOrEqual(1);
    expect(Math.max(...layout.rowCenters) - Math.min(...layout.rowCenters)).toBeLessThanOrEqual(2);
    expect(layout.utilityLeft).toBeGreaterThan(layout.commandRight);
    expect(layout.panelTop).toBeGreaterThanOrEqual(layout.commandBottom);

    await page.getByTestId("planning-panel").getByRole("button", { name: "Zavřít" }).click();
    await expect(page.getByTestId("hamburger-btn")).toBeVisible();
  });

  test("personal profile omits empty achievements and starts with lazy sections collapsed", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=personal");
    await expect(page.getByTestId("mine-panel")).toBeVisible();
    await expect(page.locator(".mine-rank")).toHaveCount(0);
    await expect(page.locator(".mine-stats")).toContainText("1aktivní hry");
    await expect(page.locator(".mine-stats")).not.toContainText(/^0/);
    await expect(page.locator(".mine-accordion[open]")).toHaveCount(0);
  });

  test("mobile sheet dismisses by downward gesture and by keyboard from peek", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning");
    await page.getByTestId("mode-planning").click();
    const panel = page.getByTestId("planning-panel");
    const grabber = page.getByRole("slider", { name: "Výška panelu" });
    await expect(panel).toHaveAttribute("data-snap", "1");

    // Locator hover waits for the opening sheet animation to settle before coordinates are read.
    await grabber.hover();
    const box = await grabber.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 170, {
      steps: 10
    });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("hamburger-btn")).toBeVisible();

    await page.getByTestId("hamburger-btn").click();
    await expect(panel).toHaveAttribute("data-snap", "1");
    await grabber.focus();
    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveAttribute("data-snap", "0");
    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveCount(0);
  });

  test("767 px is phone composition while 768 px keeps the tablet command row", async ({
    page
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/?mode=planning");
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    await expect(page.locator(".mode-tabs")).toBeVisible();
    await page.getByTestId("mode-bar").getByTestId("mode-planning").click();
    await expect(page.getByTestId("planning-panel")).not.toHaveAttribute("data-snap");
    const tabletGap = await page.evaluate(() => {
      const command = document
        .querySelector<HTMLElement>('[data-testid="command-center"]')!
        .getBoundingClientRect();
      const utility = document
        .querySelector<HTMLElement>('[data-testid="utility-rail"]')!
        .getBoundingClientRect();
      return utility.left - command.right;
    });
    expect(tabletGap).toBeGreaterThanOrEqual(8);

    await page.setViewportSize({ width: 767, height: 900 });
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
    await expect(page.locator(".mode-tabs")).toHaveCount(0);
    await expect(page.getByTestId("planning-panel")).toHaveAttribute("data-snap", "1");
    await expect(page.getByTestId("brand-pill")).toBeHidden();
  });

  test("mobile input-safe layout keeps the focused form above a software keyboard", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning");
    await page.getByTestId("mode-planning").click();
    const panel = page.getByTestId("planning-panel");
    await page.getByTestId("plan-name").focus();
    await page.evaluate(() => {
      document.documentElement.dataset.softKeyboard = "open";
      document.documentElement.style.setProperty("--visual-viewport-h", "510px");
    });

    await expect(page.getByTestId("bottom-nav")).toBeHidden();
    await expect(panel).toBeVisible();
    const panelHeight = await panel.evaluate((element) => element.getBoundingClientRect().height);
    expect(panelHeight).toBeLessThanOrEqual(410);
    await expect(page.getByTestId("plan-name")).toBeFocused();
  });

  test("Nový plán replaces a previous local draft instead of reopening it", async ({ page }) => {
    await page.goto("/?mode=planning");
    await page.getByTestId("plan-name").fill("Starý rozpracovaný plán");
    await page.getByTestId("mode-personal").click();
    await page.getByText("Uložené plány", { exact: true }).click();
    await page.getByTestId("new-plan").click();

    await expect(page.getByTestId("planning-panel")).toBeVisible();
    await expect(page.getByTestId("plan-name")).toHaveValue("Nová cesta");
    await expect(page.getByLabel("Název zastávky 1")).toHaveValue("Start");
  });

  test("desktop left panel resizes within safe bounds, persists and never remounts the map", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning");
    const resizer = page.getByRole("separator", { name: "Šířka levého panelu" });
    await expect(resizer).toHaveAttribute("aria-valuenow", "380");
    await expect(resizer).toHaveAttribute("aria-valuemin", "320");
    await expect(resizer).toHaveAttribute("aria-valuemax", "560");
    await expect.poll(() => page.evaluate(() => Boolean(window.__maposMap))).toBe(true);
    await page.evaluate(() => {
      const scope = window as typeof window & { __maposMapBeforeResize?: Window["__maposMap"] };
      scope.__maposMapBeforeResize = window.__maposMap;
    });

    await resizer.hover({ position: { x: 5, y: 120 } });
    const box = await resizer.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 120);
    await page.mouse.down();
    await page.mouse.move(box!.x + 320, box!.y + 120);
    await page.mouse.up();
    await expect(resizer).toHaveAttribute("aria-valuenow", "560");

    await resizer.focus();
    await page.keyboard.press("Home");
    await expect(resizer).toHaveAttribute("aria-valuenow", "320");
    await page.keyboard.press("ArrowRight");
    await expect(resizer).toHaveAttribute("aria-valuenow", "336");
    expect(
      await page.evaluate(() => {
        const scope = window as typeof window & { __maposMapBeforeResize?: Window["__maposMap"] };
        return scope.__maposMapBeforeResize === window.__maposMap;
      })
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("mapos:left-panel-width-v1")))
      .toBe("336");

    await page.reload();
    await expect(page.getByRole("separator", { name: "Šířka levého panelu" })).toHaveAttribute(
      "aria-valuenow",
      "336"
    );
  });

  test("layer badge updates by POI/thematic rule and the basemap control exposes full text", async ({
    page
  }) => {
    await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: EMPTY_MAP_STYLE
      })
    );
    await page.goto("/");

    const badge = page.getByTestId("active-layer-count");
    await expect(badge).toHaveText("1");
    await expect(badge).toHaveAttribute("data-poi-count", "1");
    await expect(badge).toHaveAttribute("data-thematic-count", "0");

    await page.getByTestId("overflow-btn").click();
    await page.locator('label:has([data-testid="weather-visualization-temperature"])').click();
    await expect(badge).toHaveText("2");
    await expect(badge).toHaveAttribute("data-poi-count", "1");
    await expect(badge).toHaveAttribute("data-thematic-count", "1");
    await expect(page.getByTestId("overflow-btn")).toHaveAccessibleName(
      /2 aktivní: 1 POI, 1 tematické/
    );

    const basemapButton = page.getByTestId("basemap-btn");
    await expect(basemapButton).toHaveAccessibleName("Mapové podklady: CARTO Voyager");
    await expect(page.getByTestId("basemap-current-label")).toHaveText("CARTO Voyager");
    await basemapButton.click();
    await page.getByTestId("basemap-openfreemap-positron").click();
    await expect(basemapButton).toHaveAccessibleName("Mapové podklady: OpenFreeMap Positron");
    await expect(basemapButton).toHaveAttribute("title", "Mapové podklady: OpenFreeMap Positron");
    await expect(page.getByTestId("basemap-current-label")).toHaveText("OpenFreeMap Posit…");
  });

  test("narrow drawer exposes four horizontally scrollable presets and keyboard accordions", async ({
    page
  }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/");
    await page.getByTestId("overflow-btn").click();

    const strip = page.getByTestId("preset-strip");
    const presets = strip.locator("[data-preset-index]");
    await expect(presets).toHaveCount(4);
    expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await presets.first().focus();
    await page.keyboard.press("End");
    await expect(presets.last()).toBeFocused();
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const world = page.getByTestId("experience-selector");
    await expect(world).not.toHaveAttribute("open", "");
    await world.locator("summary").click();
    await expect(page.getByTestId("layer-source-osm")).toBeVisible();
    await expect(page.getByRole("heading", { name: "POI vrstvy", exact: true })).toBeVisible();
    await expect(page.getByText("Integrace", { exact: true })).toHaveCount(0);

    await page.getByTestId("preset-day-trip").click();
    const categories = page.getByTestId("category-accordion");
    await expect(categories).toContainText("10 vybráno");
    await categories.locator("summary").click();
    await page.getByTestId("filter-brewery").click();
    await expect(categories).toContainText("11 vybráno");
    await expect(categories).toContainText("Vlastní výběr");

    await page.reload();
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("category-accordion")).toContainText("11 vybráno");
    await expect(page.getByTestId("category-accordion")).toContainText("Vlastní výběr");

    await page.getByTestId("basemap-btn").click();
    const accordions = page.locator(".basemap-accordion");
    await expect(accordions).toHaveCount(3);
    const basemapCards = page.locator(".basemap-card");
    const previewCount = await page.locator(".basemap-preview").count();
    expect(previewCount).toBe(await basemapCards.count());
    expect(
      await page
        .locator(".basemap-preview")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height)
    ).toBeGreaterThanOrEqual(80);
    expect(
      await accordions.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-basemap-group"))
      )
    ).toEqual(["street", "satellite", "terrain"]);
    const street = page.locator('[data-basemap-group="street"]');
    const streetSummary = page.getByTestId("basemap-group-street");
    await expect(street).toHaveAttribute("open", "");
    await streetSummary.focus();
    await page.keyboard.press("Enter");
    await expect(street).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(street).toHaveAttribute("open", "");

    await page.getByTestId("right-utility-close").click();
    await page.getByTestId("settings-btn").click();
    await expect(
      page.getByTestId("right-utility-drawer").getByText("Mapa", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Mapové podklady", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Tiles", { exact: true })).toHaveCount(0);
  });

  test("multiple manifest legends expand by layer and stack above the shared timeline", async ({
    page
  }) => {
    await page.route("**/config", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        json: { ...body, capabilities: { ...body.capabilities, ticketmaster: true } }
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => Boolean(window.__maposMap))).toBe(true);
    await page.evaluate(() => {
      const scope = window as typeof window & { __maposMapBeforeLegends?: Window["__maposMap"] };
      scope.__maposMapBeforeLegends = window.__maposMap;
    });

    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-earthquakes").click();
    await page.getByTestId("overflow-events").click();
    await page.getByTestId("overflow-btn").click();

    const legends = page.getByTestId("legend-stack");
    await expect(legends).toContainText("2 legendy");
    const expand = page.getByTestId("legend-expand");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(legends.locator('[role="listitem"]')).toHaveCount(2);
    await expect(legends).toContainText("Magnituda zemětřesení");
    await expect(legends).toContainText("1 M");
    await expect(legends).toContainText("Stav události");
    await expect(legends).toContainText("Naplánováno");
    await expect(page.getByTestId("active-layer-count")).toHaveAttribute(
      "data-thematic-count",
      "2"
    );
    await expect(page.getByTestId("global-timeline")).toBeVisible();

    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".panel-left")!;
      const legend = document.querySelector<HTMLElement>(".legend-tray")!;
      const timeline = document.querySelector<HTMLElement>(".map-timeline")!;
      return {
        panelRight: panel.getBoundingClientRect().right,
        legendLeft: legend.getBoundingClientRect().left,
        legendBottom: legend.getBoundingClientRect().bottom,
        timelineTop: timeline.getBoundingClientRect().top
      };
    });
    expect(layout.legendLeft).toBeGreaterThanOrEqual(layout.panelRight);
    expect(layout.legendBottom).toBeLessThanOrEqual(layout.timelineTop + 1);
    expect(
      await page.evaluate(() => {
        const scope = window as typeof window & { __maposMapBeforeLegends?: Window["__maposMap"] };
        return scope.__maposMapBeforeLegends === window.__maposMap;
      })
    ).toBe(true);
  });

  test("footer stays between both desktop drawers at a narrow 1100px viewport", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto("/?mode=planning");
    await expect(page.getByTestId("planning-panel")).toBeVisible();

    await page.getByTestId("overflow-btn").click();
    const rightDrawer = page.getByTestId("right-utility-drawer");
    await expect(rightDrawer).toBeVisible();
    await page.getByTestId("overflow-earthquakes").click();
    await expect(page.getByTestId("legend-stack")).toBeVisible();
    await expect(page.getByTestId("global-timeline")).toBeVisible();

    const layout = await page.evaluate(() => {
      const left = document.querySelector<HTMLElement>(".panel-left")!.getBoundingClientRect();
      const right = document
        .querySelector<HTMLElement>(".shell-right-drawer")!
        .getBoundingClientRect();
      const footer = document
        .querySelector<HTMLElement>(".map-footer-stack")!
        .getBoundingClientRect();
      const legend = document.querySelector<HTMLElement>(".legend-tray")!.getBoundingClientRect();
      const timeline = document
        .querySelector<HTMLElement>(".map-timeline")!
        .getBoundingClientRect();
      return {
        leftRight: left.right,
        rightLeft: right.left,
        footer: { left: footer.left, right: footer.right, width: footer.width },
        legend: { left: legend.left, right: legend.right },
        timeline: { left: timeline.left, right: timeline.right }
      };
    });

    expect(layout.footer.width).toBeGreaterThan(0);
    for (const surface of [layout.footer, layout.legend, layout.timeline]) {
      expect(surface.left).toBeGreaterThanOrEqual(layout.leftRight);
      expect(surface.right).toBeLessThanOrEqual(layout.rightLeft);
    }
  });
});
