import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures/offlineTest";

const DIR = "e2e/screenshots";
const EMPTY_FEATURES = {
  type: "FeatureCollection",
  features: []
};

test.describe("global task center", () => {
  test("keeps concurrent map work separate and expands without covering the footer", async ({
    page
  }) => {
    await mkdir(DIR, { recursive: true });
    let releaseRequests!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    await page.route(/\/api\/layers\/(?:osm-poi|vanlife|inaturalist)\/features/u, async (route) => {
      await requestGate;
      await route.fulfill({ json: EMPTY_FEATURES });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      "/?mode=planning&layers=osm-poi,vanlife,inaturalist&lng=13.3775&lat=49.7475&z=14"
    );

    const center = page.getByTestId("task-center");
    await expect(center).toBeVisible();
    await expect(center.getByRole("button", { name: /3 souběžné úlohy/u })).toBeVisible();
    await center.getByRole("button", { name: /3 souběžné úlohy/u }).click();
    await expect(center.getByTestId("task-center-entry")).toHaveCount(3);
    await expect(center).toContainText("Piny a místa");
    await expect(center.getByRole("button", { name: "Zrušit" })).toHaveCount(3);

    const geometry = await page.evaluate(() => {
      const center = document
        .querySelector<HTMLElement>('[data-testid="task-center"]')!
        .getBoundingClientRect();
      const footerEntries = [
        ...document.querySelectorAll<HTMLElement>(".map-footer-contribution")
      ].map((element) => element.getBoundingClientRect());
      const intersects = (left: DOMRect, right: DOMRect) =>
        left.left < right.right &&
        left.right > right.left &&
        left.top < right.bottom &&
        left.bottom > right.top;
      return {
        withinViewport: center.right <= innerWidth && center.bottom <= innerHeight,
        clearOfFooter: footerEntries.every((entry) => !intersects(center, entry))
      };
    });
    expect(geometry.withinViewport).toBe(true);
    expect(geometry.clearOfFooter).toBe(true);
    await page.screenshot({ path: `${DIR}/1440-task-center-concurrent.png`, fullPage: true });

    releaseRequests();
    await expect(center).toHaveCount(0);
  });

  test("shows a contextual retryable failure in the mobile safe area", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    let retryMode = false;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, async (route) => {
      if (!retryMode) {
        await route.fulfill({ status: 503, json: { error: "fixture outage" } });
        return;
      }
      await retryGate;
      await route.fulfill({ json: EMPTY_FEATURES });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning&layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    const center = page.getByTestId("task-center");
    await expect(center).toContainText("1 úloha vyžaduje pozornost");
    await center.getByRole("button", { name: /1 úloha vyžaduje pozornost/u }).click();
    await expect(center).toContainText("Vrstva se nepodařila načíst");
    await expect(center.getByRole("button", { name: "Zkusit znovu" })).toBeVisible();
    await expect(center.getByRole("button", { name: "Skrýt" })).toBeVisible();
    await expect(center.getByRole("button", { name: "Zrušit" })).toHaveCount(0);

    const safeGeometry = await center.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bottomNav = document
        .querySelector<HTMLElement>('[data-testid="bottom-nav"]')!
        .getBoundingClientRect();
      return {
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
        aboveBottomNavigation: rect.bottom <= bottomNav.top
      };
    });
    expect(safeGeometry.noHorizontalOverflow).toBe(true);
    expect(safeGeometry.aboveBottomNavigation).toBe(true);
    await page.screenshot({ path: `${DIR}/390-task-center-error.png`, fullPage: true });

    retryMode = true;
    await center.getByRole("button", { name: "Zkusit znovu" }).click();
    await expect(center).toContainText("Načítám OSM POI");
    releaseRetry();
    await expect(center).toHaveCount(0);
  });
});
