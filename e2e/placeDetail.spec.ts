import { expect, test, type Page } from "@playwright/test";

/** A POI carrying everything the panels key off: an OSM ref, a QID, contact details and a
 *  Foursquare id. Placed inside the requested bbox so it actually reaches the places list. */
function poisWithin(requestUrl: string) {
  const [west, south, east, north] = new URL(requestUrl).searchParams
    .get("bbox")!
    .split(",")
    .map(Number) as [number, number, number, number];

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [(west + east) / 2, (south + north) / 2]
        },
        properties: {
          id: "osm:240",
          name: "Hrad Okoř",
          category: "castle",
          layerId: "osm-poi",
          sourceRefs: "osm:240|wikidata:Q1132187",
          wikidata: "Q1132187",
          fsqId: "4b0588",
          website: "https://example.org/okor",
          phone: "+420 123 456 789",
          opening_hours: "Út-Ne 09:00-17:00"
        }
      }
    ]
  };
}

async function openDetail(page: Page) {
  await page.route("**/layers/osm-poi/features**", (route) =>
    route.fulfill({ json: poisWithin(route.request().url()) })
  );
  await page.goto("/?layers=osm-poi&mode=poi");
  await page.getByTestId("place-card").first().click();
  await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
}

test.describe("place detail", () => {
  test("opens on the overview, showing fields the map carried", async ({ page }) => {
    await openDetail(page);

    await expect(page.getByTestId("panel-prehled")).toBeVisible();
    await expect(page.getByTestId("fact-hours")).toHaveText("Út-Ne 09:00-17:00");
    await expect(page.getByTestId("fact-website")).toHaveText("example.org");
    await expect(page.getByTestId("provenance")).toContainText("OpenStreetMap");
    await expect(page.getByTestId("provenance")).toContainText("Wikidata");
  });

  test("offers a tab per source the place can be looked up in", async ({ page }) => {
    await openDetail(page);

    for (const id of ["prehled", "wikipedia", "wikidata", "pocasi", "foursquare"]) {
      await expect(page.getByTestId(`info-tab-${id}`)).toBeVisible();
    }
  });

  test("switching tabs swaps the panel", async ({ page }) => {
    await page.route("**/info/wikipedia**", (route) =>
      route.fulfill({
        json: {
          lang: "cs",
          title: "Okoř",
          extract: "Zřícenina hradu severozápadně od Prahy.",
          url: "https://cs.wikipedia.org/wiki/Oko%C5%99",
          thumbnail: null
        }
      })
    );
    await openDetail(page);

    await page.getByTestId("info-tab-wikipedia").click();
    await expect(page.getByTestId("panel-wikipedia")).toContainText("Zřícenina hradu");
    await expect(page.getByTestId("panel-prehled")).toBeHidden();
  });

  test("a panel with no content says so instead of showing an error", async ({ page }) => {
    await page.route("**/info/wikipedia**", (route) =>
      route.fulfill({ status: 404, json: { message: "Article not found" } })
    );
    await openDetail(page);

    await page.getByTestId("info-tab-wikipedia").click();
    await expect(page.getByTestId("info-panel-body")).toContainText("žádný článek");
  });

  test("a place with no extra sources still opens with the basics", async ({ page }) => {
    await page.route("**/layers/osm-poi/features**", (route) => {
      const [west, south, east, north] = new URL(route.request().url()).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [(west + east) / 2, (south + north) / 2]
              },
              properties: {
                id: "osm:999",
                name: "Bezejmenná lavička",
                category: "bench",
                layerId: "osm-poi"
              }
            }
          ]
        }
      });
    });

    await page.goto("/?layers=osm-poi&mode=poi");
    await page.getByTestId("place-card").first().click();
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("info-tab-prehled")).toBeVisible();
    await expect(page.getByTestId("info-tab-wikidata")).toHaveCount(0);
    await expect(page.getByTestId("info-tab-foursquare")).toHaveCount(0);
    await expect(page.getByTestId("copy-gps")).toBeVisible();
  });
});
