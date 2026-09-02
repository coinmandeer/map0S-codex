import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures/offlineTest";

const DIR = "e2e/screenshots";
const EMPTY_FEATURES = {
  type: "FeatureCollection",
  features: []
};

/** §4.12: one loading surface, bottom right above the zoom controls. It replaced the expandable
 *  task centre and the letter strip of place sources — which of seven providers is slow belongs
 *  in the layer drawer, not on top of the map. */
test.describe("activity indicator", () => {
  test("shows concurrent map work as rows that clear the footer and then disappear", async ({
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

    const indicator = page.getByTestId("activity-indicator");
    await expect(indicator).toBeVisible();
    // Three layers are loading, and the cap is three rows (ACTIVITY_MAX_ROWS).
    await expect(indicator.getByTestId("activity-row")).toHaveCount(3);
    // No expander and no per-task cancel: the pill reports, the drawer controls.
    await expect(indicator.getByRole("button", { name: "Zrušit" })).toHaveCount(0);

    const geometry = await page.evaluate(() => {
      const pill = document
        .querySelector<HTMLElement>('[data-testid="activity-indicator"]')!
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
        withinViewport: pill.right <= innerWidth && pill.bottom <= innerHeight,
        clearOfFooter: footerEntries.every((entry) => !intersects(pill, entry))
      };
    });
    expect(geometry.withinViewport).toBe(true);
    expect(geometry.clearOfFooter).toBe(true);
    await page.screenshot({ path: `${DIR}/1440-activity-concurrent.png`, fullPage: true });

    releaseRequests();
    // A settled row keeps its label for 200 ms while it shows a tick, and other map work may
    // still be in flight, so the contract is that nothing is left running.
    await expect(page.locator('.activity-row[data-tone="running"]')).toHaveCount(0);
  });

  test("keeps a failed row in the mobile safe area and opens the layer drawer from it", async ({
    page
  }) => {
    await mkdir(DIR, { recursive: true });
    await page.route(/\/api\/layers\/osm-poi\/features/u, async (route) => {
      await route.fulfill({ status: 503, json: { error: "fixture outage" } });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning&layers=osm-poi&lng=13.3775&lat=49.7475&z=14");

    const indicator = page.getByTestId("activity-indicator");
    const failedRow = indicator.getByTestId("activity-row").filter({ hasText: "OSM" });
    await expect(failedRow).toHaveAttribute("data-tone", "error");

    const safeGeometry = await indicator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bottomNav = document
        .querySelector<HTMLElement>('[data-testid="bottom-nav"]')!
        .getBoundingClientRect();
      const sheet = document
        .querySelector<HTMLElement>('[data-testid="planning-panel"]')!
        .getBoundingClientRect();
      return {
        // 1 px of slack: the pill's width is fractional, and scrollWidth rounds up where
        // clientWidth rounds down.
        noHorizontalOverflow:
          element.scrollWidth <= element.clientWidth + 1 && rect.left >= 0 && rect.right <= 390,
        aboveBottomNavigation: rect.bottom <= bottomNav.top,
        // The sheet owns the lower half of a phone screen; the pill rides above it.
        aboveSheet: rect.bottom <= sheet.top
      };
    });
    expect(safeGeometry.noHorizontalOverflow).toBe(true);
    expect(safeGeometry.aboveBottomNavigation).toBe(true);
    expect(safeGeometry.aboveSheet).toBe(true);
    await page.screenshot({ path: `${DIR}/390-activity-error.png`, fullPage: true });

    // The row is a button: it hands over to the notice in the layer drawer, which is where the
    // upstream message and the retry live.
    await failedRow.click();
    await expect(page.getByTestId("right-utility-drawer")).toBeVisible();
  });
});
