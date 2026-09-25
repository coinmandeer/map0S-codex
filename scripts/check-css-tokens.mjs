#!/usr/bin/env node

/** Fails when a stylesheet reads a custom property nothing defines.
 *
 *  `--radius-md` was used twenty times without ever being declared, which CSS resolves to an
 *  empty value: every one of those corners silently rendered square (§29.2 fix 2). A typo in a
 *  custom property is invisible at runtime, so it has to be caught here.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_ROOTS = [
  path.join(REPO_ROOT, "apps/web/src/styles"),
  path.join(REPO_ROOT, "apps/web/src"),
  path.join(REPO_ROOT, "apps/runtime-starter/src")
];

const SOURCE_ROOTS = [
  path.join(REPO_ROOT, "apps/web/src"),
  path.join(REPO_ROOT, "apps/runtime-starter/src"),
  path.join(REPO_ROOT, "packages/map-runtime/src")
];

/** Supplied by a library rather than by us: MapLibre's controls and Base UI's positioner and
 *  tab indicator all publish custom properties onto their own elements. */
const EXTERNAL_PROPERTIES = new Set([
  "--maplibregl-ctrl-border-radius",
  "--transform-origin",
  "--active-tab-width",
  "--active-tab-left",
  "--active-tab-height",
  "--active-tab-top",
  "--available-height",
  "--available-width",
  "--anchor-width",
  "--anchor-height"
]);

async function filesWithin(directory, extensions) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return filesWithin(entryPath, extensions);
        return extensions.has(path.extname(entry.name)) ? [entryPath] : [];
      })
  );
  return nested.flat();
}

const files = [
  ...new Set(
    (await Promise.all(STYLE_ROOTS.map((root) => filesWithin(root, new Set([".css"]))))).flat()
  )
];
const sources = new Map();
for (const file of files) sources.set(file, await readFile(file, "utf8"));

const declared = new Set(EXTERNAL_PROPERTIES);
for (const source of sources.values()) {
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/gu)) declared.add(match[1]);
}

// Properties written from components — inline styles and `setProperty` — are declared too.
const codeFiles = [
  ...new Set(
    (
      await Promise.all(SOURCE_ROOTS.map((root) => filesWithin(root, new Set([".ts", ".tsx"]))))
    ).flat()
  )
];
for (const file of codeFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/["'`](--[a-z0-9-]+)["'`]/gu)) declared.add(match[1]);
}

const problems = [];
for (const [file, source] of sources) {
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    // A usage that carries a fallback — `var(--motion-index, 0)` — is safe by construction.
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gu)) {
      const name = match[1];
      if (match[2] === "," || declared.has(name)) continue;
      problems.push(`${path.relative(REPO_ROOT, file)}:${index + 1} uses undeclared ${name}`);
    }
  });
}

if (problems.length) {
  console.error("Undeclared CSS custom properties:\n" + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}

console.log(`check-css-tokens: ${files.length} stylesheets, ${declared.size} properties declared`);
