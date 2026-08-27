import { expect, test } from "@playwright/test";

const DAY_MS = 86_400_000;

function isoDaysFromNow(days: number, hour = 20): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

/** Events land inside whatever bbox the app asked for, on the days the histogram is checked
 *  against: two tomorrow, one in five days. */
function eventsWithin(requestUrl: string) {
  const [west, south, east, north] = new URL(requestUrl)
    .searchParams.get("bbox")!
    .split(",")
    .map(Number) as [number, number, number, number];

  const schedule = [1, 1, 5];
  return {
    type: "FeatureCollection",
    features: schedule.map((dayOffset, i) => {
      const t = (i + 1) / (schedule.length + 1);
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [west + (east - west) * t, south + (north - south) * t]
        },
        properties: {
          id: `tm:${i}`,
          name: `Koncert ${i}`,
          layerId: "events",
          category: "event",
          startsAt: isoDaysFromNow(dayOffset),
          venue: "Hala"
        }
      };
    })
  };
}

test.describe("events timeline", () => {
  test.beforeEach(async ({ page }) => {
    // The layer is gated on a server key the dev server doesn't have, so the capability is
    // faked rather than the key.
    await page.route("**/config", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        json: { ...body, capabilities: { ...body.capabilities, ticketmaster: true } }
      });
    });
    await page.route("**/layers/events/features**", (route) =>
      route.fulfill({ json: eventsWithin(route.request().url()) })
    );
  });

  test("the range writes itself into the layer's filters", async ({ page }) => {
    const windows: Array<{ from: string | null; to: string | null }> = [];
    page.on("request", (req) => {
      if (!req.url().includes("/layers/events/features")) return;
      const params = new URL(req.url()).searchParams;
      windows.push({ from: params.get("from"), to: params.get("to") });
    });

    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-events").click();
    // The menu stays open over the timeline, so it has to be dismissed before clicking through.
    await page.getByTestId("overflow-btn").click();

    await expect(page.getByTestId("events-timeline")).toBeVisible({ timeout: 20_000 });

    // The default window is today plus a week, and the layer asks for exactly that.
    await expect
      .poll(() => windows.filter((w) => w.from && w.to).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const week = windows.findLast((w) => w.from && w.to)!;
    expect(new Date(week.to!).getTime() - new Date(week.from!).getTime()).toBeGreaterThan(
      6 * DAY_MS
    );

    await page.getByTestId("events-preset-today").click();
    await expect(page.getByTestId("events-preset-today")).toHaveAttribute("aria-pressed", "true");

    // Moving the range refetches — the timeline writes a filter and the engine does the rest.
    await expect
      .poll(
        () =>
          windows.some(
            (w) => w.from && w.to && w.from.slice(0, 10) === w.to.slice(0, 10)
          ),
        { timeout: 20_000 }
      )
      .toBe(true);
  });

  test("the histogram counts what the map loaded and arrows move a handle", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-events").click();

    await expect(page.getByTestId("events-count")).toContainText("3", { timeout: 20_000 });

    // Two events tomorrow, one on day five: the bar heights are the proof the axis is drawn
    // from real data rather than being an empty strip.
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll(".range-bar")].slice(0, 6).map((el) => (el as HTMLElement).style.height)
    );
    expect(heights[1]).toBe("100%");
    expect(heights[5]).toBe("50%");

    const from = page.getByTestId("events-range-from");
    await expect(from).toHaveAttribute("aria-valuenow", "0");
    await from.focus();
    await page.keyboard.press("ArrowRight");
    await expect(from).toHaveAttribute("aria-valuenow", "1");
    await expect(page.getByTestId("events-range")).toContainText("zítra");
  });
});
