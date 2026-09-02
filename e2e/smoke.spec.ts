import { test, expect } from "./fixtures/offlineTest";
import { discoverContextFixture, stubDiscoverContext } from "./fixtures/discoverContext";

test.describe("MapOS V3 smoke", () => {
  test("mode bar is visible with layers control", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("layers-btn")).toBeVisible();
    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);
    await page.getByTestId("planning-panel").getByRole("button", { name: "Zavřít" }).click();
    const panelToggle = page.getByTestId("hamburger-btn");
    await expect(panelToggle).toBeVisible();
    await expect(page.getByTestId("left-context-host")).toHaveAttribute("data-context", "closed");
    await expect(panelToggle).toHaveAttribute("aria-expanded", "false");
    await panelToggle.click();
    await expect(page.getByTestId("left-context-host")).toHaveAttribute("data-context", "mode");
    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);
    await expect(page.getByTestId("command-center")).toBeVisible();
  });

  test("the command pill shows the wordmark when the map has the window to itself", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("planning-panel").getByRole("button", { name: "Zavřít" }).click();
    await expect(page.getByTestId("brand-pill")).toContainText("MapOS");
    // §3.1 gives up the wordmark before it gives up a mode label, so an open panel drops it.
    await page.getByTestId("hamburger-btn").click();
    await expect(page.getByTestId("brand-pill")).toHaveCount(0);
    await expect(page.getByTestId("mode-planning")).toContainText("Plánování");
  });

  test("planning panel opens", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("layer-switcher")).toBeVisible();
  });

  test("layers drawer exposes only the four canonical presets", async ({ page }) => {
    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("layers-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();
    await expect(page.getByTestId("usecase-menu")).toBeVisible();
    await expect(page.locator("[data-preset-index]")).toHaveCount(4);
    await expect(page.getByTestId("preset-day-trip")).toBeVisible();
    await expect(page.getByTestId("preset-city")).toBeVisible();
    await expect(page.getByTestId("preset-travel")).toBeVisible();
    await expect(page.getByTestId("preset-sport")).toBeVisible();
  });

  test("the sport usecase turns on its categories and the trail overlay", async ({ page }) => {
    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("preset-sport").click();

    const layers = await page.evaluate(
      () => new URLSearchParams(location.search).get("layers") ?? ""
    );
    expect(layers).toContain("waymarked-trails");

    await expect(page.getByTestId("filter-via_ferrata")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("filter-skatepark")).toHaveAttribute("aria-pressed", "true");
  });

  test("filter categories toggle in layers megamenu", async ({ page }) => {
    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("category-accordion").locator("summary").click();
    await expect(page.getByTestId("filter-castle")).toBeVisible();
    await page.getByTestId("filter-castle").click();
  });

  test("settings uses the target registry while place sources stay in Layers", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await expect(page.getByTestId("settings-registry")).toBeVisible();
    await expect(page.getByTestId("theme-segmented")).toBeVisible();
    await expect(page.getByTestId("density-segmented")).toBeVisible();
    await expect(page.getByTestId("units-segmented")).toBeVisible();
    await expect(page.getByTestId("ai-enabled-toggle")).toBeVisible();
    await expect(page.getByTestId("provider-osm")).toHaveCount(0);
    await expect(page.getByTestId("provider-mapy")).toHaveCount(0);
    await expect(page.getByText("Pohyb", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("experience-selector").locator("summary").click();
    for (const source of [
      "osm",
      "mapy",
      "wikidata",
      "wikipedia",
      "overture",
      "park4night",
      "fsq",
      "user"
    ]) {
      await expect(page.getByTestId(`layer-source-${source}`)).toBeVisible();
    }
    await expect(page.getByTestId("layer-source-wikipedia")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("layer-source-park4night")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("layer-source-overture")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  // Every visitor starts with a persistent guest profile. The first account action upgrades that
  // same identity, so pins and XP are not orphaned by a separate registration.
  test("auth sheet upgrades the guest profile or lets it sign into an existing account", async ({
    page
  }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await page.getByTestId("settings-account").click();
    await expect(page.getByTestId("auth-sheet")).toBeVisible();
    await expect(page.getByTestId("auth-sheet")).toContainText("Uložit profil");
    await expect(page.getByTestId("auth-sheet")).toContainText("zůstanou zachované");

    await page.getByText("Už účet mám").click();
    await expect(page.getByTestId("auth-email")).toBeVisible();
    await expect(page.getByTestId("auth-submit")).toContainText("Přihlásit");
  });

  test("park4night stays out of the menu until a deployment asks for it", async ({ page }) => {
    // The source preference remains visible, while the separately rendered layer needs the
    // technical server capability. The offline fixture server deliberately reports it as off.
    await page.goto("/");
    await page.getByTestId("layers-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();
    await expect(page.getByTestId("overflow-park4night")).toHaveCount(0);
  });

  test("park4night appears once the server reports the capability", async ({ page }) => {
    await page.route("**/config", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { capabilities: Record<string, unknown> };
      body.capabilities.park4night = true;
      return route.fulfill({ json: body });
    });
    await page.route("**/layers/park4night/features**", (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );

    await page.goto("/");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("overflow-park4night").click();
    await expect(page.getByTestId("toast")).toContainText("Park4Night");
  });

  test("game mode lazy-loads the three.js layer without crashing", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route("**/game/zones", (route) =>
      route.fulfill({ json: { zones: [], quests: [] } })
    );
    await page.route("**/game/ghosts**", (route) => route.fulfill({ json: { ghosts: [] } }));
    await page.route("**/game/encounters**", (route) =>
      route.fulfill({ json: { encounters: [] } })
    );

    await page.goto("/");
    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("orb-count")).toBeVisible();
    expect(pageErrors).toHaveLength(0);
  });

  test("search input is always visible with my location", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("place-search")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("location-btn")).toBeVisible();
  });

  test("mobile exposes exactly four canonical modes and keeps weather additive", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/game/zones", (route) =>
      route.fulfill({ json: { zones: [], quests: [] } })
    );
    await page.route("**/game/ghosts**", (route) => route.fulfill({ json: { ghosts: [] } }));
    await page.route("**/game/encounters**", (route) =>
      route.fulfill({ json: { encounters: [] } })
    );

    await page.goto("/");
    const bottomNav = page.getByTestId("bottom-nav");
    await expect(bottomNav).toBeVisible({ timeout: 30_000 });
    await expect(bottomNav.getByRole("button")).toHaveCount(4);
    await expect(page.getByTestId("place-search")).toBeVisible();
    await expect(page.getByTestId("mode-personal")).toBeVisible();
    await expect(page.getByTestId("mode-planning")).toBeVisible();
    await expect(page.getByTestId("mode-discover")).toBeVisible();
    await expect(page.getByTestId("mode-game")).toBeVisible();
    await expect(page.getByTestId("mode-weather")).toHaveCount(0);
    await expect(page.getByTestId("mode-mine")).toHaveCount(0);
    await expect(bottomNav).toContainText("Osobní");
    await expect(bottomNav).toContainText("Plán");
    await expect(bottomNav).toContainText("Objevuj");
    await expect(bottomNav).toContainText("Hra");

    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 15_000 });

    await page.goto("/?mode=weather");
    await expect(page).toHaveURL(/[?&]mode=discover(?:&|$)/);
    await expect(page.getByTestId("mode-discover")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("global-timeline")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("layers-btn").click();
    await expect(page.getByTestId("weather-visualization-radar")).toBeChecked();
    await expect(page.getByTestId("weather-visualization-temperature")).toBeVisible();
  });

  test("discover mode follows the map with a sourced region hierarchy", async ({ page }) => {
    await stubDiscoverContext(page);
    await page.goto("/?mode=discover");
    await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("discover-context-pin")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hierarchie oblasti" })).toContainText(
      "Česko / Plzeňský kraj / Plzeň"
    );
    await expect(page.getByRole("button", { name: "Zjistit co je tady" })).toBeVisible();
    await expect(page.getByTestId("discover-panel").getByTestId("country-picker")).toHaveCount(0);
    await expect(page.locator('[data-testid^="region-"]')).toHaveCount(0);
  });

  test("discover weather is visible but spends data only after the accordion opens", async ({
    page
  }) => {
    let weatherRequests = 0;
    await stubDiscoverContext(page);
    await page.route("**/info/weather**", (route) => {
      weatherRequests += 1;
      return route.fulfill({
        json: {
          current: { temperature: 18.4, windSpeed: 11, windDirection: 240, code: 2 },
          hourly: Array.from({ length: 12 }, (_, index) => ({
            time: `2026-09-02T${String(index).padStart(2, "0")}:00`,
            temperature: 13 + index / 2,
            precipitation: index === 6 ? 0.4 : 0,
            code: index === 6 ? 61 : 2
          })),
          daily: [
            { date: "2026-09-02", min: 12, max: 21, precipitation: 0, code: 2 },
            { date: "2026-09-03", min: 13, max: 22, precipitation: 1.2, code: 61 }
          ],
          source: { label: "Open-Meteo", url: "https://open-meteo.com/" }
        }
      });
    });

    await page.goto("/?mode=discover");
    const weather = page.getByTestId("discover-weather");
    await expect(weather).toBeVisible({ timeout: 30_000 });
    expect(weatherRequests).toBe(0);
    await weather.locator(":scope > summary").click();
    await expect(weather).toContainText("18°");
    expect(weatherRequests).toBe(1);
    const firstDay = weather.getByTestId("forecast-day").first();
    await firstDay.locator(":scope > summary").click();
    await expect(firstDay.locator(".daily-forecast-hour")).toHaveCount(4);
    await expect(firstDay).toContainText("06:00");
    await expect(firstDay).toContainText("0.4 mm");
    expect(await weather.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    await weather.locator(":scope > summary").click();
    await weather.locator(":scope > summary").click();
    await expect(weather).toContainText("18°");
    expect(weatherRequests).toBe(1);
  });

  test("discover keeps the guide and provenance inline without legacy tabs", async ({ page }) => {
    await page.route("**/v2/discover/context**", (route) =>
      route.fulfill({
        json: discoverContextFixture({
          guide: {
            area: "Plzeň",
            lang: "cs",
            sourceId: "wikivoyage",
            attribution: "Wikivoyage (CC BY-SA 4.0)",
            url: "https://cs.wikivoyage.org/wiki/Plze%C5%88",
            sections: [
              {
                id: "see",
                title: "Co vidět",
                items: [
                  {
                    name: "Velká synagoga",
                    lng: 13.3736,
                    lat: 49.7466,
                    description: "Druhá největší synagoga v Evropě.",
                    sourceRef: "wikivoyage:cs:Plzeň#Velká synagoga"
                  }
                ]
              }
            ]
          },
          sources: [
            {
              id: "guide:wikivoyage",
              label: "wikivoyage",
              attribution: "Wikivoyage (CC BY-SA 4.0)",
              url: "https://cs.wikivoyage.org/wiki/Plze%C5%88",
              license: "CC BY-SA 4.0",
              fetchedAt: "2026-09-01T12:00:00.000Z"
            }
          ],
          blocks: [
            { id: "region", status: "ready", sourceIds: ["nominatim-osm"] },
            { id: "guide", status: "ready", sourceIds: ["guide:wikivoyage"] },
            { id: "model", status: "skipped", sourceIds: [] }
          ]
        })
      })
    );

    await page.goto("/?mode=discover");
    await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("discover-guide")).toContainText("Velká synagoga");
    await expect(page.getByTestId("discover-panel")).toContainText("Wikivoyage");
    await expect(page.locator('[data-testid^="discover-tab-"]')).toHaveCount(0);
    await expect(page.getByText("Příspěvky lidí")).toHaveCount(0);
  });
});
