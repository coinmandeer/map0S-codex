import { createHash } from "node:crypto";
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
  await page.goto("/?layers=osm-poi&mode=discover&lng=13.3775&lat=49.7475&z=13");
  await openAccessibleMapFeature(page, "Hrad Okoř");
  await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
}

test.describe("place detail", () => {
  async function stubOverview(page: Page) {
    const asked: Record<string, unknown>[] = [];
    await page.route("**/v2/ai/overview", (route) => {
      asked.push(route.request().postDataJSON());
      const targetKey = createHash("sha256")
        .update(JSON.stringify(route.request().postDataJSON().target))
        .digest("hex");
      const snapshot = {
        targetKey,
        scopeFingerprint: "scope",
        revision: 1,
        geometryRevision: "empty",
        status: "complete",
        sources: [
          {
            id: "osm",
            sourceRecordId: "osm:240",
            providerId: "osm",
            label: "OpenStreetMap",
            url: "https://www.openstreetmap.org/",
            relation: "same_entity",
            topic: "identity",
            kind: "fact",
            text: "Zřícenina nad soutokem.",
            retrievedAt: "2026-09-09T00:00:00Z",
            originGroup: "osm",
            access: "public"
          }
        ],
        sections: [
          {
            id: "facts",
            title: "Doložené informace",
            claims: [
              {
                id: "description",
                text: "Zřícenina nad soutokem.",
                evidenceIds: ["osm"],
                support: "source-statement"
              }
            ]
          }
        ],
        mapRefs: [],
        limitations: []
      };
      return route.fulfill({
        headers: { "content-type": "text/event-stream" },
        body: `data: ${JSON.stringify({ type: "complete", requestId: "request", runId: "run", targetKey, scopeFingerprint: "scope", seq: 1, revision: 1, snapshot })}\n\n`
      });
    });
    return asked;
  }
  test("ordinary detail shows facts and follows automatic overview enrichment", async ({
    page
  }) => {
    const asked = await stubOverview(page);
    await openDetail(page);
    await expect(page.getByTestId("pin-detail")).toHaveClass(/panel-place-detail/);
    await expect(
      page.getByTestId("pin-detail").getByRole("heading", { name: "Hrad Okoř", exact: true })
    ).toBeVisible();
    const actions = page.getByRole("group", { name: "Place actions" });
    for (const name of ["Route", "Add to plan", "Save", "Share"])
      await expect(actions.getByRole("button", { name })).toBeVisible();
    await expect.poll(() => asked.length).toBe(1);
    await expect(page.getByTestId("overview-facts")).toContainText("Zřícenina nad soutokem");
    await expect(page.getByTestId("place-brief")).toContainText("OpenStreetMap");
  });
  test("switching overview source mode does not start research", async ({ page }) => {
    const asked = await stubOverview(page);
    await openDetail(page);
    await expect(page.getByTestId("overview-facts")).toBeVisible();
    await expect.poll(() => asked.length).toBe(1);
    await page.getByRole("combobox", { name: "Overview sources" }).selectOption("local");
    expect(asked).toHaveLength(1);
    await page.getByTestId("ai-overview").getByRole("button", { name: "Refresh overview" }).click();
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]?.web).toBe(false);
  });
  test("overview sends stable pin identity and separates local context from sourced evidence", async ({
    page
  }) => {
    const asked = await stubOverview(page);
    await openDetail(page);
    await expect(page.getByTestId("overview-facts")).toBeVisible();
    expect(asked[0]?.target).toMatchObject({
      type: "poi",
      layerId: "osm-poi",
      featureId: "osm:240"
    });
    expect(asked[0]).not.toHaveProperty("sources");
    expect(asked[0]?.web).toBe(true);
    await expect(
      page.getByTestId("ai-overview").getByRole("link", { name: "Zdroj: OpenStreetMap" })
    ).toHaveAttribute("href", "https://www.openstreetmap.org/");
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

    await expect(page.getByTestId("panel-practical")).toBeVisible();
    await page.getByTestId("place-section-sources").locator("summary").click();
    await expect(page.getByTestId("provenance")).toContainText("OpenStreetMap");
    await expect(page.getByTestId("provenance")).toContainText("Wikidata");
    await expect(page.getByTestId("fact-hours")).toHaveText("Út-Ne 09:00-17:00");
    await expect(page.getByTestId("fact-website")).toHaveText("example.org");
  });

  // Commons, iNaturalist, Park4Night and the fused OSM places all send one photo URL on the
  // feature rather than a structured media list, and the card used to read only the list — so a
  // pin from a photo layer showed everything about the photograph except the photograph.
  test("a photo layer's pin leads with its photo and credits it", async ({ page }) => {
    test.setTimeout(120_000);
    await stubDiscoverContext(page);
    await page.route("**/layers/commons-photos/features**", (route) => {
      const [west, south, east, north] = new URL(route.request().url()).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      return route.fulfill({
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
                id: "commons:1",
                name: "Okoř castle ruins",
                category: "photo",
                layerId: "commons-photos",
                photo: "https://upload.wikimedia.org/thumb.jpg",
                author: "Jane Mapper",
                license: "CC-BY-SA-4.0",
                website: "https://commons.wikimedia.org/wiki/File:Thumb.jpg"
              }
            }
          ]
        }
      });
    });
    await page.route("https://upload.wikimedia.org/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+ZQAAAABJRU5ErkJggg==",
          "base64"
        )
      })
    );

    await page.goto("/?layers=commons-photos&mode=discover&lng=13.3775&lat=49.7475&z=13");
    await openAccessibleMapFeature(page, "Okoř castle ruins");

    const hero = page.getByTestId("place-hero");
    await expect(hero).toHaveClass(/place-hero-photo/, { timeout: 20_000 });
    await expect(hero.locator("img")).toHaveAttribute(
      "src",
      "https://upload.wikimedia.org/thumb.jpg"
    );
    // A picture with no provenance is the thing this app is trying not to be.
    await expect(hero).toContainText("Jane Mapper");
    await expect(hero).toContainText("CC-BY-SA-4.0");
    const openPhoto = hero.getByRole("button", { name: /Otevřít fotografii|Open photo/ });
    await openPhoto.click();
    const lightbox = page.getByTestId("media-lightbox");
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toContainText("Jane Mapper");
    const bounds = await lightbox.boundingBox();
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    expect(bounds?.width).toBe(page.viewportSize()!.width);
    await page.keyboard.press("Tab");
    await expect(lightbox.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(page.getByTestId("pin-detail")).toBeVisible();
    await expect(openPhoto).toBeFocused();
  });

  test("arrows over the photo change the photo without moving between places", async ({ page }) => {
    test.setTimeout(120_000);
    await stubDiscoverContext(page);
    await page.route("**/layers/commons-photos/features**", (route) => {
      const [west, south, east, north] = new URL(route.request().url()).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      return route.fulfill({
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
                id: "commons:arrows",
                name: "Dvě fotky",
                category: "photo",
                layerId: "commons-photos",
                author: "Jane Mapper",
                license: "CC-BY-SA-4.0",
                media: [
                  {
                    id: "a",
                    kind: "photo",
                    url: "https://upload.wikimedia.org/a.jpg",
                    sourceId: "commons",
                    sourceLabel: "Wikimedia Commons",
                    attribution: "Jane Mapper",
                    license: "CC-BY-SA-4.0",
                    moderationStatus: "approved",
                    transformStatus: "ready"
                  },
                  {
                    id: "b",
                    kind: "photo",
                    url: "https://upload.wikimedia.org/b.jpg",
                    sourceId: "commons",
                    sourceLabel: "Wikimedia Commons",
                    attribution: "Jane Mapper",
                    license: "CC-BY-SA-4.0",
                    moderationStatus: "approved",
                    transformStatus: "ready"
                  }
                ]
              }
            }
          ]
        }
      });
    });
    await page.route("https://upload.wikimedia.org/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+ZQAAAABJRU5ErkJggg==",
          "base64"
        )
      })
    );

    await page.goto("/?layers=commons-photos&mode=discover&lng=13.3775&lat=49.7475&z=13");
    await openAccessibleMapFeature(page, "Dvě fotky");

    const hero = page.getByTestId("place-hero");
    await expect(hero.locator("img")).toHaveAttribute("src", "https://upload.wikimedia.org/a.jpg");

    // The arrow changes the photograph only — the place stays the same.
    await page.getByTestId("place-hero-next").click();
    await expect(hero.locator("img")).toHaveAttribute("src", "https://upload.wikimedia.org/b.jpg");
    await expect(page.getByTestId("pin-detail")).toContainText("Dvě fotky");
  });

  test("practical facts lead and secondary requests wait for disclosure", async ({ page }) => {
    let geologyRequests = 0;
    await page.route("**/info/geology**", (route) => {
      geologyRequests++;
      return route.fulfill({ status: 404, json: { message: "No geology" } });
    });
    await openDetail(page);
    await expect(page.getByTestId("panel-practical")).toBeVisible();
    await expect(page.getByTestId("detail-section-geologie")).toHaveCount(0);
    expect(geologyRequests).toBe(0);
    await page.getByTestId("place-section-geology").locator("summary").click();
    await expect.poll(() => geologyRequests).toBeGreaterThan(0);
  });

  test("opening Wiki loads the article while retaining the basic facts", async ({ page }) => {
    await page.route("**/api/info/wikipedia**", (route) =>
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

    await page.getByRole("button", { name: "Wiki", exact: true }).click();
    await expect(page.getByTestId("panel-wikipedia")).toContainText("Zřícenina hradu");
    await expect(page.getByTestId("panel-practical")).toBeAttached();
  });

  test("a panel with no content says so instead of showing an error", async ({ page }) => {
    await page.route("**/api/info/wikipedia**", (route) =>
      route.fulfill({ status: 404, json: { message: "Article not found" } })
    );
    await openDetail(page);

    await expect(page.getByTestId("detail-section-wikipedia")).toBeHidden();
    await expect(page.getByTestId("panel-practical")).toBeVisible();
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

    await page.getByTestId("place-section-sources").locator("summary").click();
    await page.getByTestId("detail-source-open-mapy-okoli").click();
    await expect(page.getByTestId("panel-osm")).toContainText("Preview unavailable");
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

    await page.getByTestId("place-section-sources").locator("summary").click();
    await page.getByTestId("detail-source-open-mapy-okoli").click();
    const frame = page.locator('iframe.info-frame[title="OpenStreetMap"]');
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

    await page.goto("/?layers=osm-poi&mode=discover&lng=13.3775&lat=49.7475&z=13");
    await openAccessibleMapFeature(page, "Bezejmenná lavička");
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("panel-practical")).toBeVisible();
    await expect(page.getByTestId("detail-section-media")).toHaveCount(0);
    await expect(page.getByTestId("detail-section-practical")).toHaveCount(0);
    await expect(page.getByTestId("copy-gps")).toBeVisible();
    await expect(page.getByTestId("info-tab-wikidata")).toHaveCount(0);
    await expect(page.getByTestId("place-detail-tabs-panorama")).toHaveCount(0);
  });
});

test("low data keeps place images off the network until explicitly requested", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() =>
    localStorage.setItem(
      "mapos:user-preferences-v1",
      JSON.stringify({ preferences: { lowData: true, aiAutoSummary: false } })
    )
  );
  let imageRequests = 0;
  await page.route("https://upload.wikimedia.org/low-data-test.png", async (route) => {
    imageRequests++;
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+T0YvWQAAAABJRU5ErkJggg==",
        "base64"
      )
    });
  });
  await page.route("**/api/places/*", (route) =>
    route.fulfill({
      json: {
        id: "osm:240",
        name: "Hrad Okoř",
        lng: 14,
        lat: 50,
        category: "castle",
        sources: [],
        photo: "https://upload.wikimedia.org/low-data-test.png"
      }
    })
  );
  const detailResponse = page.waitForResponse((response) =>
    response.url().includes("/api/places/osm")
  );
  await openDetail(page);
  await detailResponse;
  await expect(page.getByTestId("load-place-media")).toBeVisible();
  await expect(page.getByTestId("place-hero").locator("img")).toHaveCount(0);
  expect(imageRequests).toBe(0);
  const limit = await page.evaluate(async () => {
    const path = "/src/map/tileCache.ts";
    return (await import(path)).tileCacheStats().maxBytes;
  });
  expect(limit).toBe(16 * 1024 * 1024);
  await page.getByTestId("load-place-media").click();
  await expect(page.getByTestId("place-hero").locator("img")).toBeVisible();
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  await expect(page.getByTestId("load-place-media")).toHaveCount(0);
});
