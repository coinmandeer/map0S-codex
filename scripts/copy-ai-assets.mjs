#!/usr/bin/env node
/**
 * Copies the AI prompts and eval sets into the API build.
 *
 * `tsc` emits JavaScript and leaves everything else behind, but the versioned prompts (§30.9) are
 * read at runtime: without this step the built server falls back to reading them out of `src`,
 * which only works when the sources happen to ship next to `dist`.
 */

import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directories = ["services/ai/prompts", "services/ai/evals"];

for (const directory of directories) {
  const from = resolve(repoRoot, "apps/api/src", directory);
  const to = resolve(repoRoot, "apps/api/dist", directory);
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: (path) => !path.endsWith(".ts")
  });
  console.log(`copied ${directory}`);
}
