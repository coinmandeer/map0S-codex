import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.MAPOS_PUBLIC_HOST
  ? `https://${process.env.MAPOS_PUBLIC_HOST}`
  : "https://mapos.promptstudio3000.com";
const output = "output/verification-ai-overview-v2";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block"
});
const page = await context.newPage();
const errors = [],
  overviewRequests = [];
let createdGuest = false;
page.on("pageerror", (error) => errors.push(error.name));
page.on("request", (request) => {
  if (new URL(request.url()).pathname === "/api/v2/ai/overview")
    overviewRequests.push({ at: Date.now(), method: request.method() });
});
page.on("response", async (response) => {
  if (new URL(response.url()).pathname === "/api/auth/guest" && response.ok()) {
    try {
      createdGuest = (await response.json()).created === true;
    } catch {
      /* Optional browser state may be unavailable. */
    }
  }
});
try {
  await page.goto(`${base}/?layers=osm-poi&mode=discover&lng=1.253&lat=41.119&z=15`, {
    waitUntil: "domcontentloaded"
  });
  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("discover-accordion-places").click({ timeout: 45000 });
  const first = page.getByRole("button", { name: /^Otevřít detail místa / }).first();
  await first.click();
  await expect(page.getByTestId("pin-detail")).toBeVisible();
  const overview = page.getByTestId("ai-overview");
  // The overview auto-starts for a named pin when the AI features are on; the start button is
  // only the fallback path after it has finished.
  await expect(overview).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("overview-facts")).toBeVisible({ timeout: 45000 });
  await expect(overview.getByRole("button", { name: "Zastavit", exact: true })).toHaveCount(0, {
    timeout: 30000
  });
  await expect(overview.getByRole("link").first()).toBeAttached();
  await page.screenshot({ path: `${output}/public-desktop.png` });
  const requestsBeforeResize = overviewRequests.length;
  expect(requestsBeforeResize).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("overview-facts")).toBeVisible();
  await overview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/public-mobile.png` });
  expect(overviewRequests).toHaveLength(requestsBeforeResize);
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/public-browser.json`,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        browser: await browser.version(),
        actualProviders: true,
        neutralFixtures: false,
        overviewRequests: overviewRequests.length,
        ordinaryDetailStartedResearch: true,
        resizeStartedResearch: false,
        pageErrors: errors,
        desktop: [1280, 900],
        mobile: [390, 844],
        mobileReducedMotion: true
      },
      null,
      2
    )
  );
} finally {
  if (createdGuest) {
    const cleanup = await context.request.delete(`${base}/api/v2/me`, {
      headers: { origin: base },
      data: { confirmation: "DELETE MY ACCOUNT" }
    });
    if (!cleanup.ok()) console.error(`browser smoke guest cleanup HTTP ${cleanup.status()}`);
  }
  await browser.close();
}
