#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_ROOTS = {
  api: path.join(REPO_ROOT, "apps/api/src"),
  sdk: path.join(REPO_ROOT, "packages/layer-sdk/src"),
  adapters: path.join(REPO_ROOT, "packages/adapter-sdk/src"),
  runtime: path.join(REPO_ROOT, "packages/map-runtime/src"),
  web: path.join(REPO_ROOT, "apps/web/src"),
  starter: path.join(REPO_ROOT, "apps/runtime-starter/src")
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(entryPath);
        return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
      })
  );
  return nested.flat();
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /\b(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/gm
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return [...new Set(imports)];
}

function areaFor(filePath) {
  const normalized = path.resolve(filePath);
  for (const [area, root] of Object.entries(SOURCE_ROOTS)) {
    if (normalized === root || normalized.startsWith(`${root}${path.sep}`)) return area;
  }
  return "external";
}

function resolveTarget(sourceFile, specifier) {
  if (specifier === "@mapos/layer-sdk" || specifier.startsWith("@mapos/layer-sdk/")) {
    return SOURCE_ROOTS.sdk;
  }
  if (specifier === "@mapos/map-runtime" || specifier.startsWith("@mapos/map-runtime/")) {
    return SOURCE_ROOTS.runtime;
  }
  if (specifier === "@mapos/adapter-sdk" || specifier.startsWith("@mapos/adapter-sdk/")) {
    return SOURCE_ROOTS.adapters;
  }
  if (!specifier.startsWith(".")) return null;
  return path.resolve(path.dirname(sourceFile), specifier);
}

function relative(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function violation(rule, sourceFile, specifier, message) {
  return { rule, source: relative(sourceFile), import: specifier, message };
}

export async function architectureReport() {
  const filesByArea = Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_ROOTS).map(async ([area, root]) => [area, await sourceFiles(root)])
    )
  );
  const files = Object.values(filesByArea).flat();
  const edges = [];
  const violations = [];

  for (const file of files) {
    const sourceArea = areaFor(file);
    const source = await readFile(file, "utf8");
    const sourceRelative = relative(file);

    if (
      sourceArea === "api" &&
      source.includes("chat/completions") &&
      !/^apps\/api\/src\/services\/ai\/adapters(?:\.test)?\.ts$/.test(sourceRelative)
    ) {
      violations.push(
        violation(
          "model-network-isolated",
          file,
          "chat/completions",
          "Model network transports must stay inside reviewed AI adapters."
        )
      );
    }
    if (
      sourceArea === "api" &&
      /process\.env\.(?:OPENAI_API_KEY|OLLAMA_API_KEY)/.test(source) &&
      sourceRelative !== "apps/api/src/config.ts"
    ) {
      violations.push(
        violation(
          "model-secrets-centralized",
          file,
          "process.env",
          "Model credentials may only be read by the central server configuration."
        )
      );
    }
    for (const specifier of importsFrom(source)) {
      const resolvedTarget = resolveTarget(file, specifier);
      const targetArea = resolvedTarget ? areaFor(resolvedTarget) : "external";
      edges.push({ source: relative(file), sourceArea, targetArea, import: specifier });

      if (sourceArea === "adapters" && ["api", "runtime", "web", "starter"].includes(targetArea)) {
        violations.push(
          violation(
            "adapters-are-app-independent",
            file,
            specifier,
            "Source adapters describe layers from SDK contracts; the network and the map are handed to them."
          )
        );
      }
      if (sourceArea === "adapters" && specifier === "maplibre-gl") {
        violations.push(
          violation(
            "adapters-are-renderer-independent",
            file,
            specifier,
            "An adapter returns a manifest and a tile template; only the runtime touches MapLibre."
          )
        );
      }
      if (
        sourceArea === "sdk" &&
        ["api", "runtime", "web", "starter", "adapters"].includes(targetArea)
      ) {
        violations.push(
          violation(
            "sdk-is-app-independent",
            file,
            specifier,
            "The shared SDK must not depend on either application."
          )
        );
      }
      if (
        sourceArea === "runtime" &&
        (targetArea === "api" || targetArea === "web" || targetArea === "starter")
      ) {
        violations.push(
          violation(
            "runtime-is-product-ui-independent",
            file,
            specifier,
            "The shared map runtime may depend on SDK contracts and MapLibre, not an application."
          )
        );
      }
      if (sourceArea === "starter" && (targetArea === "api" || targetArea === "web")) {
        violations.push(
          violation(
            "starter-is-clean-room",
            file,
            specifier,
            "The starter must use public workspaces without importing MapOS API or UI source."
          )
        );
      }
      if (sourceArea === "web" && targetArea === "api") {
        violations.push(
          violation(
            "web-api-separation",
            file,
            specifier,
            "The web application must reach the API through HTTP contracts, not source imports."
          )
        );
      }
      if (sourceArea === "api" && targetArea === "web") {
        violations.push(
          violation(
            "api-web-separation",
            file,
            specifier,
            "The API must not import browser application code."
          )
        );
      }

      const targetRelative = resolvedTarget ? relative(resolvedTarget) : "";
      if (
        sourceRelative.startsWith("apps/web/src/store/") &&
        targetRelative.startsWith("apps/web/src/ui/")
      ) {
        violations.push(
          violation(
            "store-does-not-own-ui",
            file,
            specifier,
            "State stores may expose a facade but must not import UI components."
          )
        );
      }
      if (
        sourceRelative.startsWith("apps/api/src/services/") &&
        (targetRelative === "apps/api/src/index" ||
          targetRelative.startsWith("apps/api/src/index.") ||
          targetRelative === "apps/api/src/memory-server" ||
          targetRelative.startsWith("apps/api/src/memory-server."))
      ) {
        violations.push(
          violation(
            "services-do-not-own-composition",
            file,
            specifier,
            "Domain services must not import a production or memory composition root."
          )
        );
      }
      if (
        sourceRelative.startsWith("apps/web/src/ui/") &&
        (/services\/dataSources|adapters\/providers/.test(specifier) || targetArea === "api")
      ) {
        violations.push(
          violation(
            "ui-does-not-own-providers",
            file,
            specifier,
            "Provider adapters belong behind registries and API contracts, not UI components."
          )
        );
      }
      if (
        sourceArea === "sdk" &&
        /^(react(?:-dom)?|maplibre-gl|three|fastify|drizzle-orm)(?:\/|$)/.test(specifier)
      ) {
        violations.push(
          violation(
            "sdk-is-renderer-and-server-neutral",
            file,
            specifier,
            "The SDK contract package must remain renderer- and server-framework-neutral."
          )
        );
      }
      if (
        (sourceArea === "runtime" || sourceArea === "starter") &&
        /^(react(?:-dom)?)(?:\/|$)/.test(specifier)
      ) {
        violations.push(
          violation(
            "clean-room-has-no-product-ui-framework",
            file,
            specifier,
            "The UI-neutral runtime and starter must not inherit MapOS React UI dependencies."
          )
        );
      }
      if (sourceArea === "api" && targetArea === "runtime") {
        violations.push(
          violation(
            "api-does-not-import-browser-runtime",
            file,
            specifier,
            "The server may import neutral SDK contracts, not the MapLibre browser runtime."
          )
        );
      }
    }
  }

  for (const expected of [
    {
      sourceArea: "runtime",
      targetArea: "sdk",
      specifier: "@mapos/layer-sdk",
      rule: "runtime-uses-public-contracts",
      message: "The map runtime must validate the same public contracts exposed by the SDK."
    },
    {
      sourceArea: "web",
      targetArea: "runtime",
      specifier: "@mapos/map-runtime",
      rule: "web-uses-shared-runtime",
      message: "MapOS must exercise the shared runtime used by clean-room applications."
    },
    {
      sourceArea: "starter",
      targetArea: "runtime",
      specifier: "@mapos/map-runtime",
      rule: "starter-uses-shared-runtime",
      message: "The clean-room starter must not substitute a parallel local runtime."
    }
  ]) {
    if (
      !edges.some(
        (edge) => edge.sourceArea === expected.sourceArea && edge.targetArea === expected.targetArea
      )
    ) {
      violations.push(
        violation(
          expected.rule,
          SOURCE_ROOTS[expected.sourceArea],
          expected.specifier,
          expected.message
        )
      );
    }
  }

  const areaEdges = {};
  for (const edge of edges) {
    const key = `${edge.sourceArea}->${edge.targetArea}`;
    areaEdges[key] = (areaEdges[key] ?? 0) + 1;
  }

  return {
    schemaVersion: "1.0.0",
    roots: Object.fromEntries(
      Object.entries(SOURCE_ROOTS).map(([area, root]) => [area, relative(root)])
    ),
    files: Object.fromEntries(
      Object.entries(filesByArea).map(([area, areaFiles]) => [area, areaFiles.length])
    ),
    importCount: edges.length,
    areaEdges,
    violations
  };
}

async function main() {
  const report = await architectureReport();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.violations.length === 0) {
    process.stdout.write(
      `Architecture boundaries OK (${report.importCount} imports across ${Object.values(report.files).reduce((sum, count) => sum + count, 0)} source files).\n`
    );
  } else {
    for (const item of report.violations) {
      process.stderr.write(
        `${item.rule}: ${item.source} imports ${item.import} — ${item.message}\n`
      );
    }
  }
  process.exitCode = report.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
