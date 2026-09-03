import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/offlineTest";

const DIR = "e2e/screenshots";

const places = [
  {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id: "saved-sunset",
    ownerUserId: "fixture-owner",
    target: { type: "embedded-snapshot" },
    snapshot: {
      title: "Vyhlídka na západ slunce",
      position: [13.372, 49.75],
      category: "viewpoint",
      sourceRefs: [],
      capturedAt: "2026-09-02T08:00:00.000Z"
    },
    category: "viewpoint",
    note: "Klidný kopec nad městem",
    tags: ["výlet", "večer"],
    collectionId: "collection-weekend",
    sortOrder: 0,
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z"
  },
  {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id: "saved-morning",
    ownerUserId: "fixture-owner",
    target: { type: "embedded-snapshot" },
    snapshot: {
      title: "Ranní vyhlídka",
      position: [13.39, 49.742],
      category: "viewpoint",
      sourceRefs: [],
      capturedAt: "2026-09-02T08:00:00.000Z"
    },
    category: "viewpoint",
    note: null,
    tags: ["východ"],
    collectionId: null,
    sortOrder: 1,
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z"
  },
  {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id: "saved-cafe",
    ownerUserId: "fixture-owner",
    target: { type: "embedded-snapshot" },
    snapshot: {
      title: "Kavárna u parku",
      position: [13.381, 49.746],
      category: "cafe",
      sourceRefs: [],
      capturedAt: "2026-09-02T08:00:00.000Z"
    },
    category: "cafe",
    note: "Dobré espresso",
    tags: ["práce"],
    collectionId: null,
    sortOrder: 2,
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z"
  }
] as const;

async function stubPersonal(page: Page, options: { empty?: boolean } = {}) {
  const empty = options.empty ?? false;
  await page.route("**/api/me/personal-summary", (route) =>
    route.fulfill({
      json: empty ? { plans: 0, places: 0, layers: 0 } : { plans: 2, places: 3, layers: 1 }
    })
  );
  await page.route(/\/api\/v2\/me\/saved-places(?:\?|$)/u, (route) =>
    route.fulfill({
      json: { savedPlaces: empty ? [] : places, nextCursor: null, limit: 100 }
    })
  );
  await page.route("**/api/v2/me/saved-place-collections", (route) =>
    route.fulfill({
      json: {
        collections: empty
          ? []
          : [
              {
                schema: "mapos.saved-place-collection",
                schemaVersion: "2.0.0",
                id: "collection-weekend",
                ownerUserId: "fixture-owner",
                name: "Víkend",
                icon: null,
                color: "#0f766e",
                visibility: "private",
                createdAt: "2026-09-02T08:00:00.000Z",
                updatedAt: "2026-09-02T08:00:00.000Z"
              }
            ]
      }
    })
  );
  await page.route("**/api/plans", (route) =>
    route.fulfill({
      json: {
        plans: empty
          ? []
          : [
              {
                id: "plan-1",
                name: "Víkend podél Berounky",
                departureAt: "2026-09-05T08:00:00.000Z",
                visibility: "private",
                stops: [{ id: "stop-1", name: "Start", lng: 13.37, lat: 49.74 }],
                vehicle: { profile: "camper" },
                lastResult: null
              },
              {
                id: "plan-2",
                name: "Podzimní hrady",
                departureAt: "2026-10-02T08:00:00.000Z",
                visibility: "unlisted",
                stops: [{ id: "stop-2", name: "Start", lng: 13.4, lat: 49.7 }],
                vehicle: { profile: "car" },
                lastResult: null
              }
            ]
      }
    })
  );
  await page.route("**/api/user-layers", (route) =>
    route.fulfill({
      json: {
        layers: empty
          ? []
          : [
              {
                id: "layer-weekend",
                name: "Víkendové tipy",
                color: "#0f766e",
                isPublic: 0,
                pinCount: 7
              }
            ]
      }
    })
  );
}

test.describe("source-grounded Personal UI", () => {
  test("shows private counts up front and composes search with category filters", async ({
    page
  }) => {
    await stubPersonal(page);
    await page.route("**/api/layers/osm-poi/features**", (route) =>
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [13.3775, 49.7475] },
              properties: {
                id: "foreign-public-place",
                name: "Cizí veřejné místo",
                category: "cafe",
                layerId: "osm-poi"
              }
            }
          ]
        }
      })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=personal&layers=osm-poi,my-saved-places&lng=13.3775&lat=49.7475&z=14");

    const panel = page.getByTestId("personal-panel");
    await expect(panel.getByTestId("personal-overview")).toBeVisible();
    await expect(panel.getByTestId("personal-count-plans")).toHaveText("2");
    await expect(panel.getByTestId("personal-count-places")).toHaveText("3");
    await expect(panel.getByTestId("personal-count-layers")).toHaveText("1");
    await expect(panel.locator(".kit-accordion-panel[data-open]")).toHaveCount(0);
    await expect(panel).not.toContainText("Poslední hledání");
    await expect(panel).not.toContainText("Cizí veřejné místo");

    await panel.getByTestId("personal-accordion-plans").click();
    await expect(panel.getByTestId("plan-row")).toHaveCount(2);
    await expect(panel.getByTestId("new-plan")).toBeVisible();
    await panel.getByTestId("personal-accordion-plans").click();

    await panel.getByTestId("personal-accordion-places").click();
    await expect(panel.getByTestId("saved-place-row")).toHaveCount(3);
    await expect(panel.getByTestId("personal-category-viewpoint")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await panel.getByTestId("personal-place-search").fill("západ");
    await expect(panel.getByTestId("saved-place-row")).toHaveCount(1);
    await expect(panel).toContainText("Vyhlídka na západ slunce");
    await panel.getByTestId("personal-category-viewpoint").click();
    await expect(panel.getByTestId("saved-place-row")).toHaveCount(1);
    await panel.getByRole("button", { name: "Vymazat" }).click();
    await expect(panel.getByTestId("saved-place-row")).toHaveCount(2);
  });

  test("keeps empty plans compact and the new-plan action available", async ({ page }) => {
    await stubPersonal(page, { empty: true });
    await page.goto("/?mode=personal");
    const panel = page.getByTestId("personal-panel");
    await panel.getByTestId("personal-accordion-plans").click();
    // §4.3: an empty section offers the action without a sentence restating the emptiness.
    await expect(panel.getByTestId("plan-row")).toHaveCount(0);
    await expect(panel.getByTestId("new-plan")).toBeVisible();
    await expect(panel.getByTestId("personal-summary")).toContainText("1 hra");
    await expect(panel.getByTestId("personal-summary")).not.toContainText("0 plánů");
  });

  test("is responsive at 200% text and produces inspected Personal captures", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    for (const width of [1440, 390] as const) {
      await stubPersonal(page);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/?mode=personal&lng=13.3775&lat=49.7475&z=14");
      if (width === 390) {
        await page.getByTestId("bottom-nav").getByTestId("mode-personal").click();
      }
      const panel = page.getByTestId("personal-panel");
      await expect(panel.getByTestId("personal-count-places")).toHaveText("3");
      await page.screenshot({ path: `${DIR}/${width}-personal-redesign.png`, fullPage: true });
      await panel.getByTestId("personal-accordion-places").click();
      await expect(panel.getByTestId("saved-place-row")).toHaveCount(3);
      await page.screenshot({ path: `${DIR}/${width}-personal-places.png`, fullPage: true });

      if (width === 390) {
        await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
        const overflow = await panel.evaluate(
          (element) => element.scrollWidth > element.clientWidth + 1
        );
        expect(overflow).toBe(false);
      }
    }
  });

  test("edits a saved note and asks before deleting a plan", async ({ page }) => {
    await stubPersonal(page);
    let patched: { id: string; note: unknown } | null = null;
    await page.route(/\/api\/v2\/me\/saved-places\/[^/]+$/u, async (route) => {
      const request = route.request();
      if (request.method() !== "PATCH") return route.fallback();
      const body = request.postDataJSON() as { note: unknown };
      patched = { id: request.url().split("/").pop()!, note: body.note };
      await route.fulfill({
        json: {
          savedPlace: { ...places[2], note: body.note as string | null }
        }
      });
    });
    let deleted = false;
    await page.route("**/api/plans/plan-1", async (route) => {
      deleted = route.request().method() === "DELETE";
      await route.fulfill({ status: 204, body: "" });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=personal");
    const panel = page.getByTestId("personal-panel");

    await panel.getByTestId("personal-accordion-places").click();
    await panel.getByRole("button", { name: "Možnosti místa Kavárna u parku" }).click();
    await page.getByTestId("saved-place-menu-saved-cafe-note").click();
    await page.getByTestId("place-note-input").fill("Zavírají v 18:00");
    await page.getByTestId("place-note-save").click();
    await expect(page.getByTestId("place-note-dialog")).toHaveCount(0);
    expect(patched).toEqual({ id: "saved-cafe", note: "Zavírají v 18:00" });

    await panel.getByTestId("personal-accordion-plans").click();
    await panel.getByRole("button", { name: "Možnosti plánu Víkend podél Berounky" }).click();
    await page.getByTestId("plan-menu-plan-1-delete").click();
    await expect(page.getByRole("dialog")).toContainText("Smazat plán?");
    await page.getByRole("button", { name: "Smazat plán" }).click();
    await expect(panel.getByTestId("plan-row")).toHaveCount(1);
    expect(deleted).toBe(true);
  });

  test("keeps personal pin priority and information hierarchy in dark mode", async ({ page }) => {
    await mkdir(DIR, { recursive: true });
    await stubPersonal(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/?mode=personal&lng=13.3775&lat=49.7475&z=14");
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await expect(page.getByTestId("personal-count-places")).toHaveText("3");
    await page.screenshot({ path: `${DIR}/1440-personal-redesign-dark.png`, fullPage: true });
  });
});
