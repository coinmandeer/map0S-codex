import { expect, test } from "./fixtures/offlineTest";
import { stubEvents } from "./fixtures/events";

const DAY_MS = 86_400_000;

async function openEvents(page: Parameters<typeof stubEvents>[0]) {
  await page.goto("/");
  await page.getByTestId("layers-btn").click();
  await page.getByTestId("overflow-events").click();
  const drawer = page.getByTestId("right-utility-drawer");
  if (await drawer.isVisible()) await page.getByTestId("right-utility-close").click();
  await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("event-explorer")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("global-timeline")).toBeVisible({ timeout: 20_000 });
}

test.describe("annual events UI", () => {
  test.beforeEach(async ({ page }) => {
    await stubEvents(page);
  });

  test("uses one host with a nonlinear full-year range instead of a competing seven-day cursor", async ({
    page
  }) => {
    const windows: Array<{ from: string | null; to: string | null }> = [];
    page.on("request", (request) => {
      if (!request.url().includes("/v2/layers/events/features")) return;
      const params = new URL(request.url()).searchParams;
      windows.push({ from: params.get("from"), to: params.get("to") });
    });

    await openEvents(page);
    await expect(page.getByText("Události na 12 měsíců", { exact: true })).toBeVisible();
    await expect(page.getByTestId("timeline-scrubber")).toBeHidden();
    await page.getByTestId("events-preset-year").click();
    await expect(page.getByTestId("events-range-from")).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByTestId("events-range-to")).toHaveAttribute("aria-valuenow", "1000");
    await expect
      .poll(
        () => {
          const current = windows.findLast((window) => window.from && window.to);
          return current ? new Date(current.to!).getTime() - new Date(current.from!).getTime() : 0;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(365 * DAY_MS);
    await expect(page.getByTestId("events-count")).toContainText("4 událostí");
  });

  test("sidebar filters map results and opens a sourced detail without calling unknown price free", async ({
    page
  }) => {
    await openEvents(page);
    await page.getByTestId("events-preset-year").click();
    const explorer = page.getByTestId("event-explorer");
    await expect(explorer.locator(".event-explorer-card")).toHaveCount(4, { timeout: 20_000 });
    await expect(explorer).toContainText("Cena neuvedena");

    await explorer.getByLabel("Kategorie událostí").selectOption("Music");
    await expect(explorer.locator(".event-explorer-card")).toHaveCount(1, { timeout: 20_000 });
    await expect(explorer).toContainText("Hudba pod širým nebem");
    await expect(explorer.getByRole("link", { name: /oficiální stránku/i })).toHaveAttribute(
      "href",
      "https://events.example.invalid/music-free"
    );

    await explorer.getByRole("button", { name: /Hudba pod širým nebem/ }).click();
    await expect(page.getByTestId("event-pin-detail")).toContainText("Hudba pod širým nebem");
    await expect(page.getByTestId("event-pin-detail")).toContainText("Event E2E fixture");
    await page.getByTestId("event-pin-detail").getByRole("button", { name: "✕" }).click();

    await explorer.getByLabel("Kategorie událostí").selectOption("");
    await explorer.getByLabel("Cena událostí").selectOption("false");
    await expect(explorer.locator(".event-explorer-card")).toHaveCount(2, { timeout: 20_000 });
    await expect(explorer).toContainText("250–500 CZK");
    await expect(explorer).not.toContainText("Souseds & mapa města");
  });

  test("mobile explorer expands by keyboard and keeps the viewport free of horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEvents(page);
    await page.getByRole("slider", { name: "Výška panelu" }).press("ArrowUp");
    const explorer = page.getByTestId("event-explorer");
    await explorer.scrollIntoViewIfNeeded();
    await expect(explorer).toBeVisible();
    await explorer.getByTestId("events-explorer-preset-year").click();
    await expect(explorer.locator(".event-explorer-card")).toHaveCount(4, { timeout: 20_000 });
    await expect(page.getByTestId("events-range-to")).toHaveAttribute("aria-valuenow", "1000");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true);
    expect(
      await explorer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
    ).toBe(true);
  });
});
