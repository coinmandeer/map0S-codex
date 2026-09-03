import { expect, test } from "./fixtures/offlineTest";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";

/**
 * §6.6 wave A: Park4Night's filters and its detail fields.
 *
 * The layer already drew pins; what it could not do was answer the question it exists for —
 * "somewhere I may sleep tonight that has electricity" — or show, once a pin was open, any of
 * the rating, amenities and link the server was already sending.
 *
 * Filtering is deliberately server-side, so these check that the choices reach the request
 * rather than that pins vanish in the browser: narrowing 1000 fetched rows client-side would
 * cap before filtering and make a filter look like an empty map.
 */

const PROPERTIES = {
  id: "p4n-109709",
  name: "Kemp u řeky",
  category: "p4n-camping",
  layerId: "park4night",
  rating: 4.5,
  reviews: 23,
  services: ["water", "electricity"],
  serviceLabels: ["Voda", "Elektřina"],
  externalUrl: "https://park4night.com/en/place/109709"
};

/** Placed at the centre of whatever bbox was asked for, so it actually reaches the places list
 *  regardless of where the viewport settles. */
function placeWithin(requestUrl: string) {
  const [west, south, east, north] = new URL(requestUrl).searchParams
    .get("bbox")!
    .split(",")
    .map(Number) as [number, number, number, number];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [(west + east) / 2, (south + north) / 2] },
        properties: PROPERTIES
      }
    ]
  };
}

/** The capability gate is off in the fixture server on purpose, so every scenario here turns it
 *  on the way a deployment holding the permission would. */
async function enableLayer(page: import("@playwright/test").Page) {
  await page.route("**/config", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { capabilities: Record<string, unknown> };
    body.capabilities.park4night = true;
    return route.fulfill({ json: body });
  });
}

async function recordRequests(page: import("@playwright/test").Page): Promise<string[]> {
  const urls: string[] = [];
  await page.route("**/layers/park4night/features**", (route) => {
    urls.push(route.request().url());
    return route.fulfill({ json: placeWithin(route.request().url()) });
  });
  return urls;
}

test.describe("Park4Night", () => {
  test("the chosen category and amenities travel to the server", async ({ page }) => {
    await enableLayer(page);
    const urls = await recordRequests(page);

    await page.goto("/?layers=park4night&lng=13.3775&lat=49.7475&z=12");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => urls.length, { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("layer-filter-btn-park4night").click();
    await page.getByTestId("filter-park4night-categories-p4n-night").click();
    await page.getByTestId("filter-park4night-services-electricity").click();

    await expect
      .poll(
        () => {
          const last = urls.at(-1) ?? "";
          const params = new URL(last).searchParams;
          return {
            categories: params.get("categories"),
            services: params.get("services")
          };
        },
        { timeout: 20_000 }
      )
      .toEqual({ categories: "p4n-night", services: "electricity" });
  });

  test("the rating slider narrows the request rather than the drawn pins", async ({ page }) => {
    await enableLayer(page);
    const urls = await recordRequests(page);

    await page.goto("/?layers=park4night&lng=13.3775&lat=49.7475&z=12");
    await expect.poll(() => urls.length, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("layer-filter-btn-park4night").click();
    const slider = page.getByTestId("filter-park4night-minRating").getByRole("slider");
    await slider.focus();
    // Whole stars, so four presses is "rated 4 and up".
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowRight");

    await expect
      .poll(() => new URL(urls.at(-1) ?? "").searchParams.get("minRating"), { timeout: 20_000 })
      .toBe("4");
  });

  test("opening a pin shows the rating, the amenities and the way back to the source", async ({
    page
  }) => {
    await enableLayer(page);
    await recordRequests(page);
    await stubDiscoverContext(page);

    await page.goto("/?layers=park4night&mode=discover");
    await openAccessibleMapFeature(page, "Kemp u řeky");

    const detail = page.getByTestId("pin-detail");
    await expect(detail).toBeVisible({ timeout: 20_000 });
    // The rating carries the headline, because "how good is it" is the first thing asked.
    await expect(detail).toContainText("★ 4.5");

    // The rest are practical facts, which is the surface they belong on.
    await page.getByTestId("detail-section-practical").click();
    const body = page.getByTestId("info-panel-body");
    await expect(body).toContainText("Počet recenzí");
    await expect(body).toContainText("Vybavení");
    // Shown in words, not as the enum ids the filter sends.
    await expect(body).toContainText("Elektřina");
    await expect(body).not.toContainText("electricity");
    await expect(body).toContainText("Zdroj");
  });
});
