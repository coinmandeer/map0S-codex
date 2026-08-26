import { test, expect } from "@playwright/test";

test.describe("MapOS V3 smoke", () => {
  test("mode bar is visible with layers control", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("overflow-btn")).toBeVisible();
    await expect(page.getByTestId("hamburger-btn")).toBeVisible();
    await expect(page.getByTestId("brand-pill")).toContainText("MapOS");
  });

  test("places panel opens", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("places-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("layer-switcher")).toBeVisible();
  });

  test("layers megamenu toggles gastro categories", async ({ page }) => {
    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();
    await expect(page.getByTestId("usecase-menu")).toBeVisible();
    await page.getByTestId("preset-gastro").click();
    await expect(page.getByTestId("toast")).toBeVisible();
  });

  test("filter categories toggle in layers megamenu", async ({ page }) => {
    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("filter-castle")).toBeVisible();
    await page.getByTestId("filter-castle").click();
  });

  test("settings sheet exposes provider and source toggles", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await expect(page.getByTestId("provider-osm")).toBeVisible();
    await expect(page.getByTestId("provider-mapy")).toBeVisible();
    await expect(page.getByTestId("poi-source-osm")).toBeVisible();
    await expect(page.getByTestId("theme-segmented")).toBeVisible();
  });

  test("auth sheet opens from settings", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("settings-sheet")).toBeVisible();
    await page.getByTestId("settings-account").click();
    await expect(page.getByTestId("auth-sheet")).toBeVisible();
    await expect(page.getByTestId("auth-email")).toBeVisible();
  });

  test("park4night layer toggles from the layers menu", async ({ page }) => {
    await page.route("**/layers/park4night/features**", (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();
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

  test("mobile uses a bottom nav with all five modes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/game/zones", (route) =>
      route.fulfill({ json: { zones: [], quests: [] } })
    );
    await page.route("**/game/ghosts**", (route) => route.fulfill({ json: { ghosts: [] } }));
    await page.route("**/game/encounters**", (route) =>
      route.fulfill({ json: { encounters: [] } })
    );

    await page.goto("/");
    await expect(page.getByTestId("bottom-nav")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("place-search")).toBeVisible();
    await expect(page.getByTestId("mode-poi")).toBeVisible();
    await expect(page.getByTestId("mode-discover")).toBeVisible();
    await expect(page.getByTestId("mode-game")).toBeVisible();
    await expect(page.getByTestId("mode-weather")).toBeVisible();
    await expect(page.getByTestId("mode-mine")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toContainText("Mapa");
    await expect(page.getByTestId("bottom-nav")).toContainText("Objevuj");
    await expect(page.getByTestId("bottom-nav")).toContainText("Hra");
    await expect(page.getByTestId("bottom-nav")).toContainText("Počasí");
    await expect(page.getByTestId("bottom-nav")).toContainText("Moje");

    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 15_000 });
  });

  test("discover mode shows country picker and region cards", async ({ page }) => {
    await page.goto("/?mode=discover&country=CZ");
    await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("country-picker")).toBeVisible();
    await expect(page.getByTestId("discover-breadcrumb")).toBeVisible();
    await expect(page.getByTestId("region-CZ-PLK")).toBeVisible();
  });
});
