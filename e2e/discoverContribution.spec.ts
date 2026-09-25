import { expect, test } from "./fixtures/offlineTest";

test("Discover contribution is a sourced revision submitted for review, not instant publishing", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=12");
  const panel = page.getByTestId("discover-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  // The review workflow is explained in the wizard now; the panel header only offers the action.
  await expect(page.getByTestId("discover-contribute")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/1440-discover-contribute.png", fullPage: true });

  await page.getByTestId("discover-contribute").click();
  const wizard = page.getByTestId("create-wizard");
  await expect(wizard).toBeVisible();
  await expect(page.getByTestId("wizard-contribution")).toContainText(/dohledatelným původem/i);
  await expect(wizard.getByRole("button", { name: /Post/ })).toHaveClass(/active/);

  await wizard.getByRole("button", { name: "Pokračovat" }).click();
  await wizard.getByRole("button", { name: "Pokračovat" }).click();
  await wizard.getByLabel("Název").fill("Klidná vyhlídka");
  await wizard.getByLabel("Popis").fill("Místní tip s ověřitelnou polohou.");
  await wizard.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.getByTestId("wizard-review-flow")).toContainText("Kontrola");
  await wizard.getByRole("button", { name: "Pokračovat" }).click();
  await expect(wizard).toContainText("Revize 2 · čeká na kontrolu");
  await expect(wizard).toContainText("Doplní přihlášená relace");
  await page.screenshot({ path: "e2e/screenshots/1440-discover-review.png", fullPage: true });

  await page.getByTestId("wizard-publish").click();
  await expect(page.getByTestId("toast")).toContainText(/revize 2.*čeká na kontrolu/i);

  const drafts = await page.evaluate(async () => {
    const response = await fetch("/api/drafts");
    return (await response.json()) as {
      drafts: Array<{
        provenance?: { source?: string; regionName?: string };
        workflow?: { status?: string; revision?: number; authorId?: string };
      }>;
    };
  });
  const submitted = drafts.drafts.at(-1);
  expect(submitted?.provenance?.source).toBe("discover");
  expect(submitted?.workflow?.status).toBe("in-review");
  expect(submitted?.workflow?.revision).toBe(2);
  expect(submitted?.workflow?.authorId).toBeTruthy();
});

test("Discover contribution stays readable in the mobile panel and sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=12");
  const contribution = page.getByTestId("discover-contribute");
  await expect(contribution).toBeVisible({ timeout: 30_000 });
  const panel = page.getByTestId("discover-panel");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "e2e/screenshots/390-discover-contribute.png", fullPage: true });

  await contribution.click();
  const wizard = page.getByTestId("create-wizard");
  await expect(wizard).toBeVisible();
  expect(await wizard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "e2e/screenshots/390-discover-review.png", fullPage: true });
});
