#!/usr/bin/env node
/** Captures the kit gallery in both themes.
 *
 *  Used as the Phase 0 acceptance evidence (§7 "KitGallery screenshot light/dark without
 *  visual errors") and re-run whenever a token changes, so a palette edit can be reviewed as
 *  two images rather than by clicking through the app.
 *
 *  Usage: `node e2e/kit-gallery-shot.mjs [outDir]` with the dev server already running. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "docs/shots/phase-0");
const baseUrl = process.env.MAPOS_WEB_URL ?? "http://localhost:5173";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(`${baseUrl}/?kit=1`, { waitUntil: "networkidle" });
// The icon font is `font-display: block`; without waiting the glyphs shoot as blank boxes.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

for (const theme of ["light", "dark"]) {
  await page.evaluate((next) => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", next === "dark");
    root.classList.toggle("theme-light", next === "light");
    root.style.colorScheme = next;
  }, theme);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/kit-${theme}.png`, fullPage: true });
  console.log(`wrote ${outDir}/kit-${theme}.png`);
}

await browser.close();

if (problems.length > 0) {
  console.error(`\n${problems.length} console error(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("No console errors.");
