import { expect, test } from "./fixtures/offlineTest";
import { mkdir } from "node:fs/promises";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";
import { catalogSwitch, openCatalogSettings, openLayersPanel } from "./fixtures/mapPanel";

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
      // Weather is one folded-in section of the detail, not a panel of its own.
      await expect(
        page.locator('[data-testid="detail-section-pocasi"]:not(.place-detail-disclosure *)')
      ).toHaveCount(0);
      await mkdir("output/playwright", { recursive: true });
      await page.screenshot({ path: `output/playwright/detail-${width}-${locale}.png` });

      await openLayersPanel(page);
      await expect(page.getByTestId("layers-view-all")).toHaveAttribute("aria-pressed", "true");
      // Cafés are one row of the shared POI layer; its settings open inline, inside the panel.
      const settings = await openCatalogSettings(page, "osm-poi", "poi-cafe");
      const bounds = await settings.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `output/playwright/layer-settings-${width}-${locale}.png` });
      const cafes = await catalogSwitch(page, "osm-poi", "poi-cafe");
      if (!(await cafes.isChecked())) await cafes.click();
      await expect(cafes).toBeChecked();
      await page.getByTestId("layers-search").fill("");
      await page.getByTestId("layers-view-active").click();
      await expect(page.locator('[data-testid="active-switch-poi-cafe"]')).toBeChecked();
      await expect(page.locator('[data-testid$="-switch-earthquakes"]')).toHaveCount(0);
      await page.reload();
      await openLayersPanel(page);
      await page.getByTestId("layers-view-all").click();
      await page.getByTestId("layers-search").fill(locale === "cs" ? "Kavárny" : "Cafés");
      await expect(page.locator('[data-testid$="-switch-poi-cafe"]').first()).toBeVisible();
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
