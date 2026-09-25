import { expect, test } from "./fixtures/offlineTest";
import { mkdir } from "node:fs/promises";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";

for (const width of [390, 1440])
  for (const locale of ["cs", "en"]) {
    test(`layers and place detail remain usable at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) =>
          localStorage.setItem(
            "mapos:user-preferences-v1",
            JSON.stringify({ preferences: { locale, theme: "dark" } })
          ),
        locale
      );
      await stubDiscoverContext(page);
      await page.route("**/layers/osm-poi/features**", (route) => {
        const bbox = new URL(route.request().url()).searchParams
          .get("bbox")!
          .split(",")
          .map(Number);
        return route.fulfill({
          json: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [(bbox[0]! + bbox[2]!) / 2, (bbox[1]! + bbox[3]!) / 2]
                },
                properties: {
                  id: "osm:240",
                  name: "Café Test",
                  category: "cafe",
                  layerId: "osm-poi",
                  opening_hours: "Mo-Su 10:00-22:00",
                  address: "Main Street 1"
                }
              }
            ]
          }
        });
      });
      await page.route("**/api/places/*", (route) =>
        route.fulfill({ status: 503, json: { message: "Test offline detail" } })
      );
      await page.goto("/?layers=osm-poi&mode=discover&lng=14.42&lat=50.08&z=13");
      await openAccessibleMapFeature(page, "Café Test");
      await expect(
        page.getByTestId("pin-detail").getByRole("heading", { name: "Café Test" })
      ).toBeVisible();
      await expect(page.getByTestId("fact-hours")).toHaveText("Mo-Su 10:00-22:00");
      await expect(page.getByTestId("place-detail-tabs-photos")).toHaveCount(0);
      await expect(page.getByTestId("place-detail-tabs-panorama")).toHaveCount(0);
      await expect(page.locator("iframe.info-frame")).toHaveCount(0);
      await expect(page.getByTestId("ai-overview")).toHaveCount(0);
      await expect(page.getByTestId("detail-section-pocasi")).toHaveCount(0);
      await mkdir("output/playwright", { recursive: true });
      await page.screenshot({ path: `output/playwright/detail-${width}-${locale}.png` });

      await page.getByTestId("layers-btn").click();
      await expect(page.getByTestId("layers-view-all")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("layer-filter-btn-osm-poi").click();
      const settings = page.getByTestId("layer-filter-osm-poi");
      await expect(settings).toBeVisible();
      const bounds = await settings.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      if (width < 900) expect(bounds!.y + bounds!.height).toBeCloseTo(900, 0);
      await page.getByTestId("category-groups-food").click();
      const chip = page.getByTestId("filter-cafe");
      const previous = await chip.getAttribute("aria-pressed");
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", previous === "true" ? "false" : "true");
      await page.screenshot({ path: `output/playwright/layer-settings-${width}-${locale}.png` });
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();
      await expect(page.getByTestId("overflow-menu")).toBeVisible();
      await page.getByTestId("layers-view-active").click();
      await expect(page.getByTestId("overflow-osm-poi")).toBeChecked();
      await expect(page.getByTestId("overflow-earthquakes")).toHaveCount(0);
      await page.reload();
      await page.getByTestId("layers-btn").click();
      await expect(page.getByTestId("layers-view-active")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("layers-view-all").click();
      await page.getByTestId("layers-search").fill(locale === "cs" ? "Kavárny" : "Cafés");
      await expect(page.getByTestId("filter-cafe")).toBeVisible();
      await page.getByTestId("layers-search").fill("");
      await page.screenshot({ path: `output/playwright/layers-${width}-${locale}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.getByTestId("preset").click();
      await page.getByTestId("preset-day-trip").click();
      await expect(page.getByTestId("preset-clear")).toBeEnabled();
      await expect(page.locator(".kit-dialog")).toHaveCount(0);
    });
  }
