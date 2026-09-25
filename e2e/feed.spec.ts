import { expect, test } from "./fixtures/offlineTest";

test.describe("Feed mode", () => {
  test("lists public posts in the current viewport and opens one on the map", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The offline fixtures put two public pins in Plzeň, so the feed has to be looked at from
    // there — the panel is scoped by viewport, not by country.
    await page.goto("/?mode=feed&lng=13.3775&lat=49.7475&z=13");

    const panel = page.getByTestId("feed-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const list = page.getByTestId("feed-list");
    await expect(list.getByRole("button")).toHaveCount(2);
    // The row says what it is, who posted it and which layer it belongs to — the whole point of
    // anchoring a post to a layer (§26).
    await expect(list).toContainText("Pivovarské muzeum");
    await expect(list).toContainText("Plzeň tipy");
    await expect(list).toContainText("MapOS Demo");

    await list.getByRole("button").first().click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("z"), { timeout: 10_000 })
      .toBe("14.0");
  });

  test("the following filter says it is empty rather than showing everyone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=feed&lng=13.3775&lat=49.7475&z=13");
    await expect(page.getByTestId("feed-list").getByRole("button")).toHaveCount(2);

    await page.getByTestId("feed-scope").getByRole("button", { name: "Sleduji" }).click();
    await expect(page.getByTestId("feed-empty")).toBeVisible();
    await expect(page.getByTestId("feed-empty")).toContainText("sleduješ");
    await expect(page.getByTestId("feed-list").getByRole("button")).toHaveCount(0);
  });

  test("a new post opens the wizard as a public contribution", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=feed&lng=13.3775&lat=49.7475&z=13");
    await expect(page.getByTestId("feed-panel")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("feed-new-post").click();
    const wizard = page.getByTestId("create-wizard");
    await expect(wizard).toBeVisible();
    await expect(wizard).toContainText("Nový příspěvek");
    // Provenance names Feed, not Discover, so the draft records where it really came from.
    await expect(page.getByTestId("wizard-contribution")).toContainText("Feed");
  });

  test("five modes fit the top bar and the mobile nav without clipping a label", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=personal");
    await expect(page.getByTestId("personal-panel")).toBeVisible({ timeout: 30_000 });

    // §7: the panel is open at 1440, which is the tightest ordinary desktop. The modes live in
    // the floating dock now, and their labels stay unclipped there.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll(".desktop-mode-label")].map((node) => ({
        text: node.textContent,
        clipped: node.scrollWidth > node.clientWidth + 1
      }))
    );
    expect(clipped).toHaveLength(5);
    expect(clipped.filter((entry) => entry.clipped)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.getByTestId("bottom-nav");
    await expect(nav.getByRole("button")).toHaveCount(5);
    const navClipped = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="bottom-nav"] button')].map((node) => {
        const box = node.getBoundingClientRect();
        return { text: node.textContent, right: Math.round(box.right) };
      })
    );
    // Every tap target has to stay inside a 390 px phone; a fifth item must not push one off.
    expect(navClipped.every((entry) => entry.right <= 390)).toBe(true);
  });
});
