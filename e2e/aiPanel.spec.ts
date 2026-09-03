import { expect, test, type Page } from "./fixtures/offlineTest";

/** One orchestrator answer with a single place, so the thread has something to render and the
 *  card has coordinates to fly to. */
function answer(text: string) {
  return {
    status: "succeeded",
    conversation: { id: "conv-1", revision: 1, scope: { type: "global" } },
    answer: {
      text,
      results: [
        {
          id: "osm:41",
          layerId: "osm-poi",
          title: "Kemp U Řeky",
          longitude: 13.3785,
          latitude: 49.7485,
          distanceMeters: 1240,
          source: { sourceId: "osm", label: "OpenStreetMap" }
        }
      ]
    }
  };
}

const QUESTION = "kde najdu klidný kemp u vody?";

/** The assistant is reached from search: one answer in the popover is a lookup, a conversation
 *  belongs in the left panel (§4.13). The returned handle lets a test make later turns fail. */
async function openPanel(page: Page) {
  const state = { failing: false };
  await page.route("**/v2/ai/orchestrate", (route) =>
    state.failing
      ? route.fulfill({ status: 503, json: { message: "model unavailable" } })
      : route.fulfill({ json: answer("Nejblíž je kemp u řeky.") })
  );
  await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=13");
  await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });

  await page.getByTestId("place-search").fill(QUESTION);
  await page.getByTestId("search-offer-ai").click();
  await expect(page.getByTestId("search-ai-results")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("search-ai-open-panel").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
  return state;
}

test.describe("AI panel", () => {
  test("carries the question over from search and answers with sourced place cards", async ({
    page
  }) => {
    await openPanel(page);

    const thread = page.getByTestId("ai-panel-thread");
    // The question is not retyped here, and the answer arrives without a second confirmation.
    await expect(thread).toContainText(QUESTION);
    await expect(thread).toContainText("Nejblíž je kemp u řeky.", { timeout: 20_000 });
    // Places are cards with a distance and their source, not names buried in the paragraph.
    await expect(thread).toContainText("OpenStreetMap");
    await expect(thread.getByRole("button", { name: /Kemp U Řeky/ })).toBeVisible();
  });

  test("says once what leaves the browser and stays dismissed", async ({ page }) => {
    await openPanel(page);

    const privacy = page.getByTestId("ai-panel-privacy");
    await expect(privacy).toContainText("střed mapy");
    await privacy.getByRole("button", { name: "Rozumím" }).click();
    await expect(privacy).toHaveCount(0);

    await openPanel(page);
    await expect(page.getByTestId("ai-panel-privacy")).toHaveCount(0);
  });

  test("a suggested place opens its detail and the assistant is one click back", async ({
    page
  }) => {
    await openPanel(page);
    const thread = page.getByTestId("ai-panel-thread");
    await expect(thread.getByRole("button", { name: /Kemp U Řeky/ })).toBeVisible({
      timeout: 20_000
    });

    await thread.getByRole("button", { name: /Kemp U Řeky/ }).click();
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("pin-detail-back").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });

  test("a cleared thread offers the empty state, and a follow-up asks again", async ({ page }) => {
    await openPanel(page);
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });

    await page.getByTestId("ai-panel-clear").click();
    await expect(page.getByTestId("ai-panel-empty")).toBeVisible();

    await page.getByLabel("Na co se chceš zeptat?").fill("a co voda poblíž?");
    await page.getByTestId("ai-panel-send").click();
    await expect(page.getByTestId("ai-panel-thread")).toContainText("a co voda poblíž?");
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });
  });

  test("a failed turn keeps the question visible and explains itself", async ({ page }) => {
    const state = await openPanel(page);
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });

    state.failing = true;
    await page.getByLabel("Na co se chceš zeptat?").fill("a kde se dá dolít voda?");
    await page.getByTestId("ai-panel-send").click();

    await expect(page.getByTestId("ai-panel-error")).toBeVisible({ timeout: 20_000 });
    // The failure replaces only that answer: the question and the earlier turn stay readable.
    await expect(page.getByTestId("ai-panel-thread")).toContainText("a kde se dá dolít voda?");
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.");
  });
});
