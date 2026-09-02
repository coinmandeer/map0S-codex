#!/usr/bin/env node
/** Subsets Material Symbols Rounded down to the ligatures listed in
 *  `apps/web/src/ui/kit/icons.ts`.
 *
 *  The full variable font is 5.1 MB and even the wght-only axis build is 939 kB, which is
 *  more than the rest of the app's JavaScript. The icons are reached by ligature (the text
 *  "my_location" is substituted for one glyph), so the subset has to keep the latin letters
 *  and underscore that spell the names plus the GSUB ligature table — harfbuzz retains
 *  layout features by default, so passing the names as text is enough.
 *
 *  Run via `npm run icons` after editing the icon list. The output is committed so a plain
 *  `npm install && npm run build` never needs harfbuzz.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const SOURCE = resolve(
  repo,
  "node_modules/@fontsource-variable/material-symbols-rounded/files/material-symbols-rounded-latin-full-normal.woff2"
);
const ICON_LIST = resolve(repo, "apps/web/src/ui/kit/icons.ts");
const OUT = resolve(repo, "apps/web/src/assets/fonts/material-symbols-rounded-subset.woff2");

/** Reads the names out of the TypeScript source rather than importing it, so the script
 *  stays runnable without a build step. */
async function readIconNames() {
  const source = await readFile(ICON_LIST, "utf8");
  const block = source.match(/export const ICON_NAMES = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error(`Could not find ICON_NAMES in ${ICON_LIST}`);
  const names = [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("ICON_NAMES is empty");
  return names;
}

const names = await readIconNames();
const source = await readFile(SOURCE);

// Ligature lookup needs every character that spells a name, and the subsetter needs them as
// a flat character set. Joining with a separator keeps the intent readable in a stack trace.
const text = names.join(" ");

const subset = await subsetFont(source, text, {
  targetFormat: "woff2",
  variationAxes: {
    // Keep FILL and wght variable so the CSS can animate a selected icon to filled and
    // match the surrounding text weight. opsz and GRAD are pinned; nothing uses them.
    FILL: { min: 0, max: 1, default: 0 },
    wght: { min: 300, max: 600, default: 400 },
    GRAD: 0,
    opsz: 24
  }
});

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, subset);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(
  `Subset ${names.length} icons: ${kb(source.length)} -> ${kb(subset.length)} (${OUT.replace(`${repo}/`, "")})`
);
