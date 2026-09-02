#!/usr/bin/env node
/* global console, process */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_LAYER_SDK_VERSION,
  MAPOS_V2_SCHEMA_VERSION,
  validateLayerContractV2,
  validateLayerManifestV2
} from "../dist/index.js";

function usage() {
  console.error(
    "Usage: mapos-layer <scaffold DIRECTORY|validate MANIFEST [host options]|contract MANIFEST [FIXTURE] [host options]>\n" +
      "Host options: --sdk-version VERSION --runtime-version VERSION --capabilities=a,b"
  );
  process.exitCode = 2;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function scaffold(directory) {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  const manifestPath = resolve(target, "layer.manifest.json");
  const fixturePath = resolve(target, "features.fixture.json");
  const manifest = {
    schema: "mapos.layer-manifest",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
    id: "partner.example-layer",
    name: "Example layer",
    description: "Replace this fixture with a reviewed declarative data source.",
    category: "community",
    geometryKinds: ["Point"],
    renderer: { type: "symbols", cluster: true },
    source: { type: "static" },
    queryPolicy: { strategy: "viewport", maxResultsPerViewport: 20 },
    attribution: [{ label: "Example publisher", license: "CC0-1.0" }],
    capabilities: ["query", "detail"]
  };
  const fixture = {
    data: { type: "FeatureCollection", features: [] },
    meta: {
      limit: 20,
      returned: 0,
      truncated: false,
      nextCursor: null,
      cache: "miss",
      sources: []
    },
    notices: []
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "wx" });
  console.log(`Created ${manifestPath}\nCreated ${fixturePath}`);
}

function commandOptions(args) {
  const positional = [];
  const host = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--sdk-version" || argument === "--runtime-version") {
      const value = args[index + 1];
      if (!value) throw new TypeError(`${argument} requires a value.`);
      if (argument === "--sdk-version") host.sdkVersion = value;
      else host.runtimeVersion = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--capabilities=")) {
      host.availableCapabilities = argument
        .slice("--capabilities=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    if (argument.startsWith("--")) throw new TypeError(`Unknown option ${argument}.`);
    positional.push(argument);
  }
  return { positional, host };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (command === "scaffold" && args.length === 1) return scaffold(args[0]);
  if (command === "validate") {
    const { positional, host } = commandOptions(args);
    if (positional.length !== 1) return usage();
    const manifest = await json(positional[0]);
    const result = validateLayerManifestV2(manifest, host);
    console.log(
      JSON.stringify(
        {
          ...result,
          layerId: typeof manifest?.id === "string" ? manifest.id : null,
          host: {
            sdkVersion: host.sdkVersion ?? MAPOS_LAYER_SDK_VERSION,
            runtimeVersion: host.runtimeVersion ?? MAPOS_HOST_RUNTIME_VERSION,
            ...(host.availableCapabilities
              ? { availableCapabilities: host.availableCapabilities }
              : {})
          }
        },
        null,
        2
      )
    );
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (command === "contract") {
    const { positional, host } = commandOptions(args);
    if (positional.length !== 1 && positional.length !== 2) return usage();
    const manifest = await json(positional[0]);
    const fixture = positional[1] ? await json(positional[1]) : undefined;
    const report = validateLayerContractV2({
      manifest,
      fixture,
      trust: "untrusted",
      publication: true,
      host
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.compatible) process.exitCode = 1;
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
