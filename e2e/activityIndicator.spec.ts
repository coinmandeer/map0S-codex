import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures/offlineTest";

const DIR = "e2e/screenshots";
const EMPTY_FEATURES = {
  type: "FeatureCollection",
  features: []
};

/** §4.12, after the shell redesign: map work reports through the one status control in the
 *  command pill. It is busy while layers load, and a failed layer raises one alert there with
 *  retry and turn-off — no separate pill stack over the map. */
test.describe("map status", () => {
  test("is busy while several layers load and settles when they are done", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    let releaseRequests!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    await page.route(/\/api\/layers\/(?:gbif|inaturalist)\/features/u, async (route) => {
      await requestGate;
      await route.fulfill({ json: EMPTY_FEATURES });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning&layers=gbif,inaturalist&lng=13.3775&lat=49.7475&z=14");

    const status = page.getByRole("button", { name: "Map status" });
    await expect(status).toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    // Loading is not a failure: nothing interrupts the user while sources are still arriving.
    await expect(page.getByRole("alert", { name: "Problém s načítáním" })).toHaveCount(0);
    await page.screenshot({ path: `${DIR}/1440-activity-concurrent.png`, fullPage: true });

    releaseRequests();
    await expect(status).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  });

  test("a failed layer raises one alert that fits a phone and offers retry", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await page.route(/\/api\/layers\/gbif\/features/u, async (route) => {
      await route.fulfill({ status: 503, json: { error: "fixture outage" } });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning&layers=gbif&lng=13.3775&lat=49.7475&z=14");

    const alert = page.getByRole("alert", { name: "Problém s načítáním" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const box = await alert.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `${DIR}/390-activity-error.png`, fullPage: true });

    let retried = false;
    page.on("request", (request) => {
      if (/\/api\/layers\/gbif\/features/u.test(request.url())) retried = true;
    });
    await alert.getByRole("button", { name: /Opakovat|Retry/ }).click();
    await expect.poll(() => retried).toBe(true);
  });
});
