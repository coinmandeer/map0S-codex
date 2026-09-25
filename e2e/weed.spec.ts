import { expect, test } from "./fixtures/offlineTest";

test("weed appears in the catalogue and draws a classified dispensary with its source", async ({
  page
}) => {
  let requests = 0;
  await page.route("**/layers/weed/features**", async (route) => {
    requests++;
    await route.fulfill({
      headers: { "cache-control": "no-store" },
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [13.3775, 49.7475] },
            properties: {
              id: "osm:node:42",
              osmId: "node:42",
              layerId: "weed",
              category: "weed-dispensary",
              name: "Example dispensary",
              website: "https://example.org",
              sourceRefs: "osm:node:42"
            }
          }
        ],
        query: { status: "complete" }
      }
    });
  });

  await page.goto("/?mode=discover&layers=weed&lng=13.3775&lat=49.7475&z=14");
  await expect.poll(() => requests, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__maposMap?.getSource("source-weed")
            ? window.__maposMap
                .querySourceFeatures("source-weed")
                .map((feature) => feature.properties)
            : []
        ),
      { timeout: 20_000 }
    )
    .toContainEqual(expect.objectContaining({ category: "weed-dispensary", osmId: "node:42" }));

  await page.getByTestId("layers-btn").click();
  await page.getByTestId("layers-search").fill("weed");
  await expect(page.getByTestId("catalog-places-weed")).toBeVisible();
  await expect(page.getByTestId("places-switch-weed")).toBeChecked();
});

test("searching for weed does not hide the existing catalogue after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("layers-btn").click();
  await page.getByTestId("layers-search").fill("weed");
  await expect(page.getByTestId("catalog-places-weed")).toBeVisible();

  await page.reload();
  await page.getByTestId("layers-btn").click();
  await expect(page.getByTestId("layers-search")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /Czech land & territories|Pozemky a území ČR/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Places & services|Místa a služby/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Weather & air quality|Počasí a ovzduší/ })
  ).toBeVisible();
});
