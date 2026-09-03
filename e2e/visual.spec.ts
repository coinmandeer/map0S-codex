import { expect, test } from "./fixtures/offlineTest";
import { mkdir } from "node:fs/promises";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";
import { stubEvents } from "./fixtures/events";

const DIR = "e2e/screenshots";
const BASELINE_MATRIX = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "mobile-large", width: 390, height: 844 },
  { name: "mobile-small", width: 360, height: 800 }
] as const;

test.describe("visual snapshots", () => {
  for (const viewport of BASELINE_MATRIX) {
    for (const theme of ["light", "dark"] as const) {
      test(`${viewport.name} ${theme} baseline`, async ({ page }) => {
        await mkdir(`${DIR}/baseline`, { recursive: true });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.goto("/?mode=personal&lng=13.3775&lat=49.7475&z=14");
        await expect(
          page.getByTestId(viewport.width < 768 ? "bottom-nav" : "mode-bar")
        ).toBeVisible({
          timeout: 30_000
        });
        await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));

        const horizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        );
        expect(horizontalOverflow, "baseline must not overflow the viewport horizontally").toBe(
          false
        );
        await page.screenshot({
          path: `${DIR}/baseline/${viewport.width}x${viewport.height}-${theme}.png`,
          fullPage: true
        });
      });
    }
  }

  test("capture header, megamenu, discover, game at 1440/768/390", async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(DIR, { recursive: true });
    await page.route("**/game/zones", (route) =>
      route.fulfill({ json: { zones: [], quests: [] } })
    );
    await page.route("**/game/ghosts**", (route) => route.fulfill({ json: { ghosts: [] } }));
    await page.route("**/game/encounters**", (route) =>
      route.fulfill({ json: { encounters: [] } })
    );
    await stubDiscoverContext(page, {
      boundary: {
        status: "ready",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [13.2, 49.6],
              [13.6, 49.6],
              [13.6, 49.9],
              [13.2, 49.9],
              [13.2, 49.6]
            ]
          ]
        },
        reason: "Simplified OpenStreetMap administrative geometry.",
        sourceId: "nominatim-osm"
      },
      guide: {
        area: "Plzeň",
        lang: "cs",
        sourceId: "wikivoyage",
        attribution: "Wikivoyage",
        url: "https://cs.wikivoyage.org/wiki/Plze%C5%88",
        sections: [
          {
            id: "understand",
            title: "O místě",
            intro: "Historické město se silnou průmyslovou tradicí a kompaktním centrem.",
            items: []
          },
          {
            id: "see",
            title: "Co vidět",
            intro: "Výběr míst dostupných v otevřeném průvodci.",
            items: [
              {
                name: "Velká synagoga",
                lng: 13.3736,
                lat: 49.7466,
                description: "Výrazná památka v centru města.",
                sourceRef: "wikivoyage:cs:Plzen#synagoga"
              },
              {
                name: "Náměstí Republiky",
                lng: 13.3776,
                lat: 49.7472,
                description: "Přirozený výchozí bod pro pěší objevování.",
                sourceRef: "wikivoyage:cs:Plzen#namesti"
              }
            ]
          }
        ]
      }
    });

    for (const width of [1440, 768, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/");
      await page.getByTestId(width < 900 ? "bottom-nav" : "mode-bar").waitFor({ timeout: 30_000 });
      const mobile = width < 900;
      if (mobile) {
        await page.getByTestId("bottom-nav").getByTestId("mode-planning").click();
      } else {
        await page.getByTestId("mode-bar").getByTestId("mode-planning").click();
      }
      await page.getByTestId("planning-panel").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/${width}-default.png`, fullPage: true });

      const aiPlanToggle = page.getByTestId("plan-ai-toggle");
      await aiPlanToggle.scrollIntoViewIfNeeded();
      await aiPlanToggle.click();
      await page.getByTestId("plan-ai-discussion").waitFor();
      await page.screenshot({ path: `${DIR}/${width}-planning-actions.png`, fullPage: true });
      await aiPlanToggle.click();

      await page.getByTestId("layers-btn").click();
      await page.getByTestId("overflow-menu").waitFor();
      await page.screenshot({ path: `${DIR}/${width}-megamenu.png`, fullPage: true });
      await page.keyboard.press("Escape");

      if (mobile) {
        await page.getByTestId("bottom-nav").getByTestId("mode-discover").click();
      } else {
        await page.getByTestId("mode-bar").getByTestId("mode-discover").click();
      }
      await page.getByTestId("discover-panel").waitFor({ timeout: 15_000 });
      await page.getByTestId("discover-summary").waitFor({ timeout: 15_000 });
      await page.getByTestId("discover-guide").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/${width}-discover.png`, fullPage: true });
      const discoverWeather = page.getByTestId("discover-weather");
      await page.getByTestId("discover-accordion-weather").click();
      await discoverWeather.locator(".discover-weather-days").waitFor({ timeout: 15_000 });
      await discoverWeather.getByTestId("forecast-day").first().locator(":scope > summary").click();
      expect(
        await discoverWeather.evaluate((element) => element.scrollWidth <= element.clientWidth),
        "expanded daily weather must not overflow its panel"
      ).toBe(true);
      await page.screenshot({ path: `${DIR}/${width}-discover-weather.png`, fullPage: true });
      await page.getByTestId("discover-accordion-weather").click();
      // Reached by URL rather than by clicking through: the Discover panel's overlay sits over
      // the nav it would have to click, and this screenshot is about the game screen, not about
      // how you get there.
      await page.goto("/?mode=game");
      await page
        .getByTestId(mobile ? "bottom-nav" : "mode-bar")
        .getByTestId("mode-game")
        .click({ force: true });
      await page.getByTestId("game-hud").waitFor({ timeout: 30_000 });
      // The HUD mounts before the basemap and the custom WebGL layer finish their first frame.
      // Waiting for the actual scene avoids snapshots of a blank canvas or the pre-game zoom.
      await page.waitForFunction(
        () =>
          Boolean(
            window.__maposMap?.isStyleLoaded() &&
            window.__maposGame?.contents.hasPlayer &&
            window.__maposGame.contents.orbs > 0 &&
            window.__maposMap.getZoom() > 16.5
          ),
        null,
        { timeout: 30_000 }
      );
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}/${width}-game.png`, fullPage: true });
    }
  });

  test("capture durable planning share and AI thread at desktop and mobile", async ({ page }) => {
    test.setTimeout(90_000);
    await mkdir(DIR, { recursive: true });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => undefined }
      });
    });
    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
      if (width < 768) await page.getByTestId("bottom-nav").getByTestId("mode-planning").click();
      await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("plan-name").fill(`Víkendový plán ${width}`);
      await page.getByTestId("save-plan").click();
      await expect(page.getByTestId("toast")).toContainText("uložený v Moje");
      await page.getByRole("button", { name: "Sdílet", exact: true }).click();
      const shareTools = page.getByTestId("plan-share-tools");
      await expect(shareTools.getByTestId("plan-share-manager")).toBeVisible();
      await expect(page.getByTestId("create-plan-share")).toBeEnabled();
      await page.getByTestId("create-plan-share").click();
      await expect(page.getByTestId("plan-share-url")).toBeVisible();
      await page.screenshot({
        path: `${DIR}/${width}-planning-share.png`,
        fullPage: true
      });
      await shareTools.getByRole("button", { name: "Zavřít" }).click();
      await expect(shareTools).toHaveCount(0);
      await page.getByTestId("plan-ai-toggle").click();
      await page
        .getByLabel("Co chceš s plánem probrat?")
        .fill("Navrhni klidnou první pauzu a vysvětli proč.");
      await page.getByRole("button", { name: "Odeslat AI" }).click();
      await expect(page.getByTestId("plan-ai-thread").locator("article")).toHaveCount(2, {
        timeout: 20_000
      });
      await page.getByTestId("plan-ai-thread").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${DIR}/${width}-planning-share-thread.png`,
        fullPage: true
      });
    }
  });

  test("capture redesigned Layers and Mapové podklady drawers", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/");
      await page.getByTestId(width < 900 ? "bottom-nav" : "mode-bar").waitFor({ timeout: 30_000 });

      await page.getByTestId("layers-btn").click();
      const layerDrawer = page.getByTestId("right-utility-drawer");
      await expect(layerDrawer).toBeVisible();
      const expectedDrawerWidth = Math.min(400, width);
      await expect
        .poll(async () => Math.round((await layerDrawer.boundingBox())!.x))
        .toBe(width - expectedDrawerWidth);
      if (width === 390) {
        expect((await layerDrawer.boundingBox())!.width).toBeGreaterThanOrEqual(389);
      }
      await page.screenshot({ path: `${DIR}/${width}-layers-redesign.png`, fullPage: true });
      await page.getByTestId("right-utility-close").click();

      await page.getByTestId("basemap-btn").click();
      await expect(page.getByTestId("tiles-sheet")).toBeVisible();
      await expect(page.locator(".basemap-preview").first()).toBeVisible();
      await page.screenshot({ path: `${DIR}/${width}-basemaps-redesign.png`, fullPage: true });
      await page.getByTestId("right-utility-close").click();
    }
  });

  test("capture annual event timeline and Discover event explorer", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await stubEvents(page);
    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      // A visual baseline must not depend on the layer-session residue from an earlier capture.
      // Open the exact canonical state that is being photographed.
      await page.goto("/?mode=discover&layers=events&lng=13.3775&lat=49.7475&z=10");
      const explorer = page.getByTestId("event-explorer");
      if (width === 390) {
        await page.getByRole("slider", { name: "Výška panelu" }).press("ArrowUp");
        await explorer.scrollIntoViewIfNeeded();
        await explorer.getByTestId("events-explorer-preset-year").click();
      } else {
        await page.getByTestId("events-preset-year").click();
      }
      await explorer.scrollIntoViewIfNeeded();
      await expect(explorer.locator(".event-explorer-card")).toHaveCount(4, {
        timeout: 20_000
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      ).toBe(true);
      await page.screenshot({ path: `${DIR}/${width}-events-explorer.png`, fullPage: true });
      await page.evaluate(() => window.sessionStorage.clear());
    }
  });

  test("capture the map-first sourced Discover boundary", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await stubDiscoverContext(page, {
      boundary: {
        status: "ready",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [13.2, 49.6],
              [13.6, 49.6],
              [13.6, 49.9],
              [13.2, 49.9],
              [13.2, 49.6]
            ]
          ]
        },
        reason: "Simplified OpenStreetMap administrative geometry.",
        sourceId: "nominatim-osm"
      }
    });
    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");
      const panel = page.getByTestId("discover-panel");
      await page.getByTestId("discover-accordion-boundary").click();
      await expect(page.getByTestId("discover-boundary-ready")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Ukázat celou" }).click();
      await expect
        .poll(() => page.evaluate(() => window.__maposMap?.isMoving() ?? true))
        .toBe(false);
      await panel.getByRole("button", { name: "Zavřít" }).click();
      await expect(panel).toHaveCount(0);
      await page.screenshot({ path: `${DIR}/${width}-discover-boundary-map.png`, fullPage: true });
    }
  });

  test("capture the place detail and the assistant in the left panel", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await stubDiscoverContext(page);
    await page.route("**/layers/osm-poi/features**", (route) => {
      const [west, south, east, north] = new URL(route.request().url()).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [(west + east) / 2, (south + north) / 2] },
              properties: {
                id: "osm:240",
                name: "Hrad Okoř",
                category: "castle",
                layerId: "osm-poi",
                sourceRefs: "osm:240|wikidata:Q1132187",
                wikidata: "Q1132187",
                website: "https://example.org/okor",
                opening_hours: "Út-Ne 09:00-17:00"
              }
            }
          ]
        }
      });
    });
    await page.route("**/info/brief**", (route) =>
      route.fulfill({
        json: {
          text: "Zřícenina gotického hradu v zaříznutém údolí, přístupná po značené cestě od parkoviště.",
          model: "fixture",
          nearby: [
            { name: "Parkoviště", category: "parking", categoryLabel: "Parkoviště", distanceM: 320 }
          ],
          attribution: "OpenStreetMap, Wikidata"
        }
      })
    );
    await page.route("**/v2/ai/orchestrate", (route) =>
      route.fulfill({
        json: {
          status: "succeeded",
          conversation: { id: "conv-1", revision: 1, scope: { type: "global" } },
          answer: {
            text: "V okolí jsou dva klidné kempy u vody, oba do 15 minut jízdy.",
            results: [
              {
                id: "osm:41",
                layerId: "osm-poi",
                title: "Kemp U Řeky",
                longitude: 13.3785,
                latitude: 49.7485,
                distanceMeters: 1240,
                source: { sourceId: "osm", label: "OpenStreetMap" }
              }
            ]
          }
        }
      })
    );

    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/?layers=osm-poi&mode=discover&lng=13.3775&lat=49.7475&z=14");
      await openAccessibleMapFeature(page, "Hrad Okoř");
      await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("brief-text")).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: `${DIR}/${width}-place-detail.png`, fullPage: true });

      await page.getByTestId("place-search").fill("kde najdu klidný kemp u vody?");
      await page.getByTestId("search-offer-ai").click();
      await page.getByTestId("search-ai-open-panel").click();
      await expect(page.getByTestId("ai-panel-thread")).toContainText("klidné kempy", {
        timeout: 20_000
      });
      // The top bar re-centres over the narrowed map; photographing mid-slide shows it in two
      // places at once.
      let previousBarX = Number.NaN;
      await expect
        .poll(
          async () => {
            const box = await page.locator(".chrome-bar").boundingBox();
            const settled = box?.x === previousBarX;
            previousBarX = box?.x ?? Number.NaN;
            return settled;
          },
          { intervals: [150, 150, 150, 150] }
        )
        .toBe(true);
      await page.screenshot({ path: `${DIR}/${width}-ai-panel.png`, fullPage: true });
    }
  });

  test("capture the registry-based Settings redesign", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/");
      await page.getByTestId(width < 900 ? "bottom-nav" : "mode-bar").waitFor({ timeout: 30_000 });
      await page.getByTestId("settings-btn").click();
      const drawer = page.getByTestId("right-utility-drawer");
      await expect(drawer).toBeVisible();
      await expect(page.getByTestId("settings-registry")).toBeVisible();
      await page.screenshot({ path: `${DIR}/${width}-settings-redesign.png`, fullPage: true });

      await page.getByTestId("settings-ai-enabled").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/${width}-settings-ai-map.png`, fullPage: true });
    }
  });

  test("capture grounded search and explicitly confirmed AI results", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await page.route(/geocode/u, (route) =>
      route.fulfill({
        json: {
          results: [
            {
              display_name: "Plzeň, Česko",
              lat: "49.7475",
              lon: "13.3775",
              type: "city",
              hierarchy: ["Plzeňský kraj", "Česko"],
              source: { id: "fixture", label: "OpenStreetMap / Nominatim" },
              confidence: { level: "high", label: "vysoká", basis: "provider-order" }
            }
          ]
        }
      })
    );

    for (const width of [1440, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/?lng=13.3775&lat=49.7475&z=13");
      const input = page.getByTestId("place-search");
      await input.fill("najdi mi nejbližší bar");
      await expect(page.getByRole("button", { name: /Plzeň, Česko/ })).toContainText(
        "Jistota: vysoká"
      );
      await page.screenshot({ path: `${DIR}/${width}-search-grounded.png`, fullPage: true });

      await page.getByTestId("search-offer-ai").click();
      await expect(page.getByTestId("search-ai-results")).toContainText("Irish Pub", {
        timeout: 20_000
      });
      await page.screenshot({ path: `${DIR}/${width}-search-ai-results.png`, fullPage: true });
    }
  });
});
