#!/usr/bin/env node
/** Downloads the game's GLB props into `apps/web/public/models/`.
 *
 *  The models live outside git (they are third-party CC0 assets, ~3 MB) but the game layer needs
 *  them locally, otherwise every prop silently falls back to a coloured cube. Run once after a
 *  fresh clone, or in CI before a build.
 *
 *  Usage: node scripts/fetch-models.mjs [--force] [--base https://host]
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "cube-guy-character.glb",
  "tree.glb",
  "tree-a.glb",
  "tree-b.glb",
  "dead-tree.glb",
  "bush.glb",
  "bamboo.glb",
  "flowers.glb",
  "mushroom.glb",
  "crystal.glb",
  "big-crystal.glb",
  "diamond-block.glb",
  "wood-chest.glb",
  "chest-open.glb",
  "key.glb",
  "demon.glb",
  "goblin.glb",
  "wolf.glb",
  "giant.glb",
  "chicken.glb",
  "hedgehog.glb"
];

const args = process.argv.slice(2);
const force = args.includes("--force");
const baseIndex = args.indexOf("--base");
const base = (baseIndex >= 0 ? args[baseIndex + 1] : undefined) ?? process.env.MODELS_BASE_URL;

if (!base) {
  console.log(
    "models: no MODELS_BASE_URL set, skipping.\n" +
      "  The game runs without them (props fall back to coloured cubes).\n" +
      "  To fetch: MODELS_BASE_URL=https://your-host node scripts/fetch-models.mjs"
  );
  process.exit(0);
}

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "web",
  "public",
  "models"
);

async function exists(path) {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

await mkdir(outDir, { recursive: true });

let downloaded = 0;
let skipped = 0;
const failed = [];

for (const file of FILES) {
  const target = join(outDir, file);
  if (!force && (await exists(target))) {
    skipped += 1;
    continue;
  }
  const url = `${base}/models/${file}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
    process.stdout.write(`. ${file}\n`);
  } catch (error) {
    failed.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`models: ${downloaded} downloaded, ${skipped} up to date, ${failed.length} failed`);
if (failed.length) {
  for (const line of failed) console.error(`  ! ${line}`);
  // Missing models degrade to cube placeholders rather than breaking the game, so a partial
  // download is a warning for humans, not a build-breaking error.
}
