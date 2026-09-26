#!/usr/bin/env node
/** Subsets Material Symbols Rounded down to the ligatures listed in
 *  `apps/web/src/ui/kit/icons.ts`.
 *
 *  The full variable font is 5.1 MB and even the wght-only axis build is 939 kB, which is
 *  more than the rest of the app's JavaScript. The icons are reached by ligature (the text
 *  "my_location" is substituted for one glyph), so the subset keeps the latin letters,
 *  digits and underscore that spell the names plus the GSUB ligature table.
 *
 *  Passing only the names as text is not enough: the subsetter's layout closure follows every
 *  ligature those letters can form, which is every icon in the font (6,000+ glyphs, 367 kB).
 *  Instead each name is shaped once to find its glyph and that glyph's private-use codepoint;
 *  the subset keeps exactly those codepoints plus the letters, with layout closure off, so
 *  only ligatures whose result survives stay in GSUB. Every name is shaped again against the
 *  result and the script fails if one no longer turns into a single icon glyph.
 *
 *  Run via `npm run icons` after editing the icon list. The output is committed so a plain
 *  `npm install && npm run build` never needs harfbuzz.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import wawoff2 from "wawoff2";

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

/** Shapes text with HarfBuzz and returns the glyph ids it produced. */
function shaper(hb, ttf) {
  const blob = hb.createBlob(ttf);
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const shape = (text) => {
    const buffer = hb.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const glyphs = buffer.json().map((glyph) => glyph.g);
    buffer.destroy();
    return glyphs;
  };
  const unicodes = face.collectUnicodes();
  const destroy = () => {
    font.destroy();
    face.destroy();
    blob.destroy();
  };
  return { shape, unicodes, destroy };
}

const names = await readIconNames();
const source = await readFile(SOURCE);
const hb = await (await import("harfbuzzjs")).default;
const full = shaper(hb, Buffer.from(await wawoff2.decompress(source)));

// Glyph → private-use codepoint, so an icon can be kept by codepoint instead of by closure.
const codepointOf = new Map();
for (const codepoint of full.unicodes) {
  if (codepoint < 0xe000) continue;
  const [glyph] = full.shape(String.fromCodePoint(codepoint));
  if (glyph && !codepointOf.has(glyph)) codepointOf.set(glyph, codepoint);
}
const iconCodepoints = names.map((name) => {
  const glyphs = full.shape(name);
  const codepoint = glyphs.length === 1 ? codepointOf.get(glyphs[0]) : undefined;
  if (codepoint === undefined) throw new Error(`"${name}" is not a single ligature in the font`);
  return codepoint;
});
full.destroy();

const letters = [...new Set(names.join(""))].join("");
const text = letters + String.fromCodePoint(...new Set(iconCodepoints));

const subset = await subsetFont(source, text, {
  targetFormat: "woff2",
  noLayoutClosure: true,
  variationAxes: {
    // Keep FILL and wght variable so the CSS can animate a selected icon to filled and
    // match the surrounding text weight. opsz and GRAD are pinned; nothing uses them.
    FILL: { min: 0, max: 1, default: 0 },
    wght: { min: 300, max: 600, default: 400 },
    GRAD: 0,
    opsz: 24
  }
});

const check = shaper(hb, Buffer.from(await wawoff2.decompress(subset)));
const broken = names.filter((name) => {
  const glyphs = check.shape(name);
  return glyphs.length !== 1 || glyphs[0] === 0;
});
check.destroy();
if (broken.length) throw new Error(`Ligatures lost in the subset: ${broken.join(", ")}`);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, subset);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(
  `Subset ${names.length} icons: ${kb(source.length)} -> ${kb(subset.length)} (${OUT.replace(`${repo}/`, "")})`
);
