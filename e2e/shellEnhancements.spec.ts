import { catalogSwitch, openBasemaps, openLayersPanel } from "./fixtures/mapPanel";
import { expect, test } from "./fixtures/offlineTest";

const EMPTY_MAP_STYLE = JSON.stringify({
  version: 8,
  name: "MapOS scenario fixture",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f3f0e8" } }]
});

test.describe("source-grounded shell enhancements", () => {
  test("desktop places the command pill at the start of the map area beside a full-height panel", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning");

    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);
    await expect(page.getByTestId("planning-panel")).toBeVisible();
    const measure = () =>
      page.evaluate(() => {
        const rect = (testId: string) =>
          document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.getBoundingClientRect();
        const command = rect("command-center");
        const search = rect("place-search");
        const settings = rect("settings-btn");
        const utility = rect("utility-rail");
        const panel = rect("planning-panel");
        return {
          commandCentre: command.left + command.width / 2,
          // §3.1: centred over the strip between the panel and the rail, not over the window.
          mapStripCentre: (panel.right + utility.left) / 2,
          rowCentres: [search.top + search.height / 2, settings.top + settings.height / 2],
          commandLeft: command.left,
          commandRight: command.right,
          panelRight: panel.right,
          utilityLeft: utility.left,
          panelTop: panel.top,
          panelHeight: panel.height,
          viewportHeight: innerHeight
        };
      });
    // The strip's edges follow the panel with a transition, so the position is asserted on the
    // settled layout rather than on the first frame after the panel appears. The pill starts
    // one inset after the panel, next to what it searches from.
    await expect
      .poll(async () => {
        const sample = await measure();
        return Math.round(sample.commandLeft - sample.panelRight);
      })
      .toBeLessThanOrEqual(16);
    const layout = await measure();
    expect(layout.commandCentre).toBeLessThan(layout.mapStripCentre);
    expect(Math.max(...layout.rowCentres) - Math.min(...layout.rowCentres)).toBeLessThanOrEqual(2);
    expect(layout.commandLeft).toBeGreaterThanOrEqual(layout.panelRight);
    expect(layout.utilityLeft).toBeGreaterThan(layout.commandRight);
    // §29.2/1: the sidebar is a full-height column starting at the top edge.
    expect(layout.panelTop).toBe(0);
    expect(layout.panelHeight).toBe(layout.viewportHeight);

    await page.getByTestId("planning-panel").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("hamburger-btn")).toBeVisible();
  });

  test("every mode renders its panel inside the viewport", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    const modes = [
      ["personal", "personal-panel"],
      ["feed", "feed-panel"],
      ["discover", "discover-panel"],
      ["planning", "planning-panel"]
    ] as const;
    for (const [mode, panel] of modes) {
      await page.goto(`/?mode=${mode}`);
      const target = page.getByTestId(panel);
      await expect(target).toBeVisible();
      // §29.2/3: Objevuj used to animate itself to left:-24px and render nothing.
      const box = await target.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.width).toBeGreaterThan(200);
    }
    // Game opens the board with its HUD rather than a panel; the panel is one button away.
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 15_000 });
  });

  test("personal profile omits empty achievements and starts with lazy sections collapsed", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=personal");
    await expect(page.getByTestId("personal-panel")).toBeVisible();
    // §4.3: the profile line lists only non-zero counts, and every section starts collapsed.
    await expect(page.getByTestId("personal-summary")).toContainText("1 hra");
    await expect(page.getByTestId("personal-summary")).not.toContainText("0 plánů");
    await expect(page.locator(".kit-accordion-panel[data-open]")).toHaveCount(0);
  });

  test("mobile sheet snaps peek/half/full, keeps a map strip and never dismisses a mode", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning");
    const panel = page.getByTestId("planning-panel");
    const grabber = page.getByRole("slider", { name: "Panel height" });
    // §21.2: an empty Plánování opens half so the map stays in view.
    await expect(panel).toHaveAttribute("data-snap", "half");

    // Locator hover waits for the opening sheet animation to settle before coordinates are read.
    await grabber.hover();
    await grabber.focus();
    await page.keyboard.press("ArrowUp");
    await expect(panel).toHaveAttribute("data-snap", "full");
    const strip = await panel.evaluate((element) => element.getBoundingClientRect().top);
    // A full sheet still leaves the 112 px map strip below the top bar (§21.2).
    expect(strip).toBeGreaterThanOrEqual(112);

    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveAttribute("data-snap", "half");
    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveAttribute("data-snap", "peek");
    // A mode panel stays at peek rather than closing, so the mode is never left empty.
    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveAttribute("data-snap", "peek");

    // The grabber is the peek↔full toggle.
    await grabber.click();
    await expect(panel).toHaveAttribute("data-snap", "full");

    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("hamburger-btn")).toBeVisible();
  });

  test("899 px is phone composition while 900 px keeps the desktop command pill", async ({
    page
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/?mode=planning");
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("desktop-modebar")).toBeVisible();
    await expect(page.getByTestId("planning-panel")).not.toHaveAttribute("data-snap");
    const desktopGap = await page.evaluate(() => {
      const command = document
        .querySelector<HTMLElement>('[data-testid="command-center"]')!
        .getBoundingClientRect();
      const utility = document
        .querySelector<HTMLElement>('[data-testid="utility-rail"]')!
        .getBoundingClientRect();
      return utility.left - command.right;
    });
    expect(desktopGap).toBeGreaterThanOrEqual(8);

    await page.setViewportSize({ width: 899, height: 900 });
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
    await expect(page.getByTestId("desktop-modebar")).toHaveCount(0);
    await expect(page.getByTestId("planning-panel")).toHaveAttribute("data-snap", "half");
    // The brief drops the wordmark on a phone; the search field owns the row instead.
    await expect(page.getByTestId("brand-pill")).toHaveCount(0);
  });

  test("mobile input-safe layout keeps the focused form above a software keyboard", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning");
    const panel = page.getByTestId("planning-panel");
    const field = page.getByLabel("Název zastávky 1");
    await field.focus();
    // The app republishes the viewport variables on focusin from a rAF, so the simulated
    // keyboard has to be written after that has settled or it is immediately overwritten.
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.documentElement.dataset.softKeyboard = "open";
      document.documentElement.style.setProperty("--visual-viewport-h", "510px");
    });

    await expect(page.getByTestId("bottom-nav")).toBeHidden();
    await expect(panel).toBeVisible();
    // The sheet is bounded by the keyboard-shrunk viewport rather than by the window, so the
    // focused field cannot end up underneath the keyboard.
    const bottom = await panel.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(510);
    await expect(field).toBeFocused();
  });

  test("Nový plán replaces a previous local draft instead of reopening it", async ({ page }) => {
    await page.goto("/?mode=planning");
    await page.getByLabel("Název zastávky 1").fill("Starý rozpracovaný start");
    await page.getByTestId("mode-personal").click();
    await page.getByText("Plans", { exact: true }).click();
    await page.getByTestId("new-plan").click();

    await expect(page.getByTestId("planning-panel")).toBeVisible();
    // A fresh plan starts from its own seed, not from the abandoned draft.
    await expect(page.getByLabel("Název zastávky 1")).not.toHaveValue("Starý rozpracovaný start");
  });

  test("desktop left panel resizes within safe bounds, persists and never remounts the map", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning");
    const resizer = page.getByRole("separator", { name: "Left panel width" });
    await expect(resizer).toHaveAttribute("aria-valuenow", "360");
    await expect(resizer).toHaveAttribute("aria-valuemin", "320");
    await expect(resizer).toHaveAttribute("aria-valuemax", "480");
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
    await expect(resizer).toHaveAttribute("aria-valuenow", "480");

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
    await expect(page.getByRole("separator", { name: "Left panel width" })).toHaveAttribute(
      "aria-valuenow",
      "336"
    );
  });

  test("layer badge updates by POI/thematic rule and the basemap tab reflects the choice", async ({
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
    await page.goto("/?lng=13.3775&lat=49.7475&z=13");
    // A plain map has nothing on, so there is no count to show.
    await expect(page.getByTestId("active-layer-count")).toHaveCount(0);

    await (await catalogSwitch(page, "osm-poi", "poi-cafe")).click();
    const badge = page.getByTestId("active-layer-count");
    await expect(badge).toHaveText("1");
    await expect(badge).toHaveAttribute("data-poi-count", "1");
    await expect(badge).toHaveAttribute("data-thematic-count", "0");

    await (await catalogSwitch(page, "weather-temperature")).click();
    await expect(badge).toHaveText("2");
    await expect(badge).toHaveAttribute("data-poi-count", "1");
    await expect(badge).toHaveAttribute("data-thematic-count", "1");
    await expect(page.getByTestId("layers-btn")).toHaveAccessibleName(/2 on: 1 POI, 1 thematic/);

    await openBasemaps(page);
    const positron = page.getByTestId("basemap-openfreemap-positron");
    await positron.click();
    await expect(positron).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("basemap-carto-voyager")).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  test("narrow drawer: preset picker, keyboard groups and basemap groups", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/?lng=13.3775&lat=49.7475&z=13");
    await openLayersPanel(page);

    // Use cases are one picker rather than a strip of cards.
    await page.getByTestId("preset").click();
    await page.getByTestId("preset-day-trip").click();
    await expect(page.getByTestId("preset-clear")).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
          return getMapStore().activePresetId;
        })
      )
      .toBe("day-trip");

    // Groups are buttons that open and close from the keyboard.
    const toggle = page.locator(".unified-layers .catalog-group-toggle").first();
    const before = await toggle.getAttribute("aria-expanded");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", before === "true" ? "false" : "true");

    await openBasemaps(page);
    const accordions = page.locator(".basemap-accordion");
    await expect(accordions.first()).toBeVisible();
    expect(await accordions.count()).toBeGreaterThanOrEqual(4);
    expect(
      (
        await accordions.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-basemap-group"))
        )
      ).slice(0, 4)
    ).toEqual(["street", "outdoor", "satellite", "terrain"]);
    const streetTrigger = page.getByTestId("basemap-group-street");
    // A group opens and closes from the keyboard, whichever state it starts in.
    const initial = await streetTrigger.getAttribute("aria-expanded");
    const flipped = initial === "true" ? "false" : "true";
    await streetTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(streetTrigger).toHaveAttribute("aria-expanded", flipped);
    await page.keyboard.press("Enter");
    await expect(streetTrigger).toHaveAttribute("aria-expanded", initial!);

    await page.getByTestId("right-utility-close").click();
    await page.getByTestId("settings-btn").click();
    // Settings do not repeat the basemap picker.
    await expect(page.getByTestId("tiles-sheet")).toHaveCount(0);
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

    await (await catalogSwitch(page, "earthquakes")).click();
    await (await catalogSwitch(page, "events")).click();
    await page.getByTestId("layers-btn").click();

    const legends = page.getByTestId("legend-stack");
    await expect(legends).toContainText("2 legends");
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

    await page.getByTestId("layers-btn").click();
    const rightDrawer = page.getByTestId("right-utility-drawer");
    await expect(rightDrawer).toBeVisible();
    await (await catalogSwitch(page, "earthquakes")).click();
    // Events carry the time axis, so with them on the footer holds a legend and the timeline.
    await (await catalogSwitch(page, "events")).click();
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
