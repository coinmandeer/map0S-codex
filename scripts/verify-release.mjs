import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "output/release/checks");
mkdirSync(output, { recursive: true });
const node = process.execPath;
const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const vite = resolve(root, "node_modules/vite/bin/vite.js");
const only = process.argv
  .find((value) => value.startsWith("--only="))
  ?.slice(7)
  .split(",");
const steps = [];
const add = (id, args, cwd = root, env = {}) => steps.push({ id, args, cwd, env });
add(
  "manifest",
  ["scripts/generate-layer-manifest-validator.mjs", "--check"],
  resolve(root, "packages/layer-sdk")
);
for (const name of ["layer-sdk", "adapter-sdk", "map-runtime"]) {
  add(`build-${name}`, [tsc, "-p", `packages/${name}/tsconfig.json`]);
}
for (const name of ["api", "web", "runtime-starter"]) {
  add(`types-${name}`, [tsc, "-p", `apps/${name}/tsconfig.json`, "--noEmit"]);
}
add("package-tests", [
  "--import",
  "tsx",
  "--test",
  "packages/layer-sdk/src/**/*.test.ts",
  "packages/adapter-sdk/src/**/*.test.ts",
  "packages/map-runtime/src/**/*.test.ts"
]);
for (const name of ["api", "web"])
  add(`${name}-tests`, ["--import", "tsx", "--test", `apps/${name}/src/**/*.test.ts`]);
add("cli-tests", ["--test", "test/**/*.test.mjs"], resolve(root, "packages/layer-sdk"));
add("contract", [
  "packages/layer-sdk/bin/mapos-layer.mjs",
  "contract",
  "packages/layer-sdk/examples/fixture-layer/layer.manifest.json",
  "packages/layer-sdk/examples/fixture-layer/features.fixture.json"
]);
add("lint", ["node_modules/eslint/bin/eslint.js", "."]);
add("format", ["node_modules/prettier/bin/prettier.cjs", "--check", "."]);
add("release-identity", ["--test", "scripts/check-release-identity.test.mjs"]);
for (const name of ["architecture-boundaries", "css-tokens", "secrets"])
  add(name, [`scripts/check-${name}.mjs`]);
add(
  "source-rights",
  [
    "--import",
    "tsx",
    "--test",
    "apps/web/src/layers/licenseGate.test.ts",
    "apps/web/src/product/browserExternalSources.test.ts"
  ],
  root,
  { MAPOS_RUN_SOURCE_RIGHTS_AUDIT: "1" }
);
add("build-api", [tsc, "-p", "apps/api/tsconfig.json"]);
add("ai-assets", ["scripts/copy-ai-assets.mjs"]);
add("build-web", [vite, "build"], resolve(root, "apps/web"));
add("build-starter-types", [tsc, "-p", "apps/runtime-starter/tsconfig.json"]);
add("build-starter", [vite, "build"], resolve(root, "apps/runtime-starter"));
add(
  "browser",
  ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.release.config.ts"],
  root,
  { MAPOS_LONG_PERF: "1" }
);

if (only?.some((id) => !steps.some((step) => step.id === id)))
  throw new Error("Unknown check; use --list");
if (process.argv.includes("--list")) {
  console.log(steps.map((step) => step.id).join("\n"));
} else {
  const selected = steps.filter((step) => !only || only.includes(step.id));
  const run = {
    startedAt: new Date().toISOString(),
    node: process.version,
    partial: Boolean(only),
    checks: []
  };
  for (const step of selected) {
    const logPath = resolve(output, `${step.id}.log`);
    const fd = openSync(logPath, "w");
    const started = Date.now();
    console.log(`Checking ${step.id}…`);
    const result = spawnSync(node, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env },
      stdio: ["ignore", fd, fd],
      timeout: step.id === "browser" ? 3_600_000 : 600_000
    });
    closeSync(fd);
    const check = {
      id: step.id,
      passed: result.status === 0,
      durationMs: Date.now() - started,
      log: logPath,
      error: result.error?.message
    };
    run.checks.push(check);
    writeFileSync(resolve(output, "latest.json"), JSON.stringify(run, null, 2) + "\n");
    console.log(`${step.id}: ${check.passed ? "PASS" : "FAIL"} (${logPath})`);
    if (!check.passed) {
      process.exitCode = 1;
      break;
    }
  }
  // This runner deliberately makes no deployment or database-restoration claim.
}
