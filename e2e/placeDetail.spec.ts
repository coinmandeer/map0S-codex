import { expect, test, type Page } from "./fixtures/offlineTest";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";

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
  await stubDiscoverContext(page);
  await page.route("**/layers/osm-poi/features**", (route) =>
    route.fulfill({ json: poisWithin(route.request().url()) })
  );
  await page.goto("/?layers=osm-poi&mode=discover");
  await openAccessibleMapFeature(page, "Hrad Okoř");
  await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
}

test.describe("place detail", () => {
  test("opens in the left panel with the hero, the action row and a loaded summary", async ({
    page
  }) => {
    await page.route("**/info/brief**", (route) =>
      route.fulfill({
        json: {
          text: "Zřícenina nad soutokem, přístupná po značené cestě.",
          model: "test-model",
          nearby: [
            { name: "Parkoviště", category: "parking", categoryLabel: "Parkoviště", distanceM: 320 }
          ],
          attribution: "OpenStreetMap, Wikidata"
        }
      })
    );
    await openDetail(page);

    // §4.10: the detail is a left-docked panel, not a modal over the map.
    await expect(page.getByTestId("pin-detail")).toHaveClass(/panel-place-detail/);
    await expect(page.getByTestId("place-hero")).toContainText("Hrad Okoř");

    const actions = page.getByRole("group", { name: "Akce místa" });
    for (const name of ["Trasa", "Do plánu", "Uložit", "Sdílet", "Více"]) {
      await expect(actions.getByRole("button", { name })).toBeVisible();
    }

    // The summary loads by itself; a summary behind a click is a tab nobody opens.
    await expect(page.getByTestId("brief-text")).toContainText("Zřícenina nad soutokem");
    await expect(page.getByTestId("place-brief")).toContainText("OpenStreetMap, Wikidata");
  });

  test("the summary can be turned off from the card and put back from the toast", async ({
    page
  }) => {
    await page.route("**/info/brief**", (route) =>
      route.fulfill({ json: { text: "Souhrn.", model: null, nearby: [], attribution: "OSM" } })
    );
    await openDetail(page);
    await expect(page.getByTestId("brief-text")).toBeVisible();

    await page.getByTestId("place-brief-off").click();
    await expect(page.getByTestId("place-brief-load")).toBeVisible();
    await page.getByTestId("toast").getByRole("button", { name: "Vrátit" }).click();
    await expect(page.getByTestId("brief-text")).toBeVisible();
  });

  test("closing the detail returns to the panel it covered", async ({ page }) => {
    await openDetail(page);

    // Discover was open under the detail, so the header offers a way back to it rather than
    // dropping the user on a bare map.
    await page.getByTestId("pin-detail-back").click();
    await expect(page.getByTestId("pin-detail")).toHaveCount(0);
    await expect(page.getByTestId("discover-panel")).toBeVisible();
  });

  test("opens on the overview, showing fields the map carried", async ({ page }) => {
    await openDetail(page);

    await expect(page.getByTestId("panel-prehled")).toBeVisible();
    await expect(page.getByTestId("provenance")).toContainText("OpenStreetMap");
    await expect(page.getByTestId("provenance")).toContainText("Wikidata");
    await page.getByTestId("detail-section-practical").click();
    await expect(page.getByTestId("fact-hours")).toHaveText("Út-Ne 09:00-17:00");
    await expect(page.getByTestId("fact-website")).toHaveText("example.org");
  });

  test("offers stable sections, then source tabs only inside their section", async ({ page }) => {
    await openDetail(page);

    for (const id of ["overview", "practical", "social", "more"]) {
      await expect(page.getByTestId(`detail-section-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("detail-section-media")).toHaveCount(0);

    await page.getByTestId("detail-section-more").click();
    for (const id of ["souhrn", "wikipedia", "wikidata", "pocasi"]) {
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

    await page.getByTestId("detail-section-more").click();
    await page.getByTestId("info-tab-wikipedia").click();
    await expect(page.getByTestId("panel-wikipedia")).toContainText("Zřícenina hradu");
    await expect(page.getByTestId("panel-prehled")).toBeHidden();
  });

  test("a panel with no content says so instead of showing an error", async ({ page }) => {
    await page.route("**/info/wikipedia**", (route) =>
      route.fulfill({ status: 404, json: { message: "Article not found" } })
    );
    await openDetail(page);

    await page.getByTestId("detail-section-more").click();
    await page.getByTestId("info-tab-wikipedia").click();
    await expect(page.getByTestId("info-panel-body")).toContainText("žádný článek");
  });

  test("a service that refuses framing offers its link instead of a blank frame", async ({
    page
  }) => {
    await page.route("**/info/embeddable**", (route) =>
      route.fulfill({
        json: { url: "https://example.org", verdict: "blocked", reason: "x-frame-options: deny" }
      })
    );
    await openDetail(page);

    await page.getByTestId("detail-section-more").click();
    await page.getByTestId("info-tab-mapy-okoli").click();
    await expect(page.getByTestId("panel-osm")).toContainText("nedovoluje vložení");
    await expect(page.locator("iframe.info-frame")).toHaveCount(0);
    await expect(page.getByTestId("panel-osm").getByRole("link")).toBeVisible();
  });

  test("an embeddable service is framed", async ({ page }) => {
    await page.route("**/info/embeddable**", (route) =>
      route.fulfill({
        json: {
          url: new URL(route.request().url()).searchParams.get("url"),
          verdict: "allowed",
          reason: "no framing restriction"
        }
      })
    );
    // The frame's own content is somebody else's server; stub it so the test stays offline.
    await page.route("https://www.openstreetmap.org/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>mapa</p>" })
    );
    await openDetail(page);

    await page.getByTestId("detail-section-more").click();
    await page.getByTestId("info-tab-mapy-okoli").click();
    const frame = page.locator("iframe.info-frame");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  test("a place with no extra sources still opens with the basics", async ({ page }) => {
    await stubDiscoverContext(page);
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

    await page.goto("/?layers=osm-poi&mode=discover");
    await openAccessibleMapFeature(page, "Bezejmenná lavička");
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("detail-section-overview")).toBeVisible();
    await expect(page.getByTestId("detail-section-media")).toHaveCount(0);
    await expect(page.getByTestId("detail-section-practical")).toHaveCount(0);
    await expect(page.getByTestId("copy-gps")).toBeVisible();
    await page.getByTestId("detail-section-more").click();
    await expect(page.getByTestId("info-tab-wikidata")).toHaveCount(0);
    await expect(page.getByTestId("info-tab-foursquare")).toHaveCount(0);
  });
});
