/* global process, structuredClone */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  MAPOS_LAYER_SDK_VERSION,
  validateLayerContractV2,
  validateLayerManifestV2
} from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(packageRoot, "bin/mapos-layer.mjs");
const packageManifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const baseManifest = JSON.parse(
  await readFile(resolve(packageRoot, "examples/fixture-layer/layer.manifest.json"), "utf8")
);
const negativeCorpus = JSON.parse(
  await readFile(
    resolve(packageRoot, "src/v2/fixtures/layer-manifest-negative-corpus.json"),
    "utf8"
  )
);

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH }
  });
}

function hostArguments(host = {}) {
  if (!host.availableCapabilities) return [];
  return [`--capabilities=${host.availableCapabilities.join(",")}`];
}

describe("mapos-layer CLI clean-room workflow", () => {
  let temporaryRoot;

  before(async () => {
    temporaryRoot = await mkdtemp(resolve(tmpdir(), "mapos-layer-cli-"));
  });

  after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("publishes the same SDK version as the host compatibility constant", () => {
    assert.equal(packageManifest.version, MAPOS_LAYER_SDK_VERSION);
  });

  it("scaffolds, validates and contracts a new offline layer in an empty directory", () => {
    const layerDirectory = resolve(temporaryRoot, "clean-room-layer");
    const scaffold = run("scaffold", layerDirectory);
    assert.equal(scaffold.status, 0, scaffold.stderr);

    const manifest = resolve(layerDirectory, "layer.manifest.json");
    const fixture = resolve(layerDirectory, "features.fixture.json");
    const validation = run("validate", manifest);
    assert.equal(validation.status, 0, validation.stderr || validation.stdout);
    assert.equal(JSON.parse(validation.stdout).valid, true);

    const contract = run("contract", manifest, fixture);
    assert.equal(contract.status, 0, contract.stderr || contract.stdout);
    assert.equal(JSON.parse(contract.stdout).compatible, true);
  });

  for (const testCase of negativeCorpus) {
    it(`rejects ${testCase.id} consistently in library and CLI entry points`, async () => {
      const manifest = { ...structuredClone(baseManifest), ...testCase.override };
      const host = testCase.host ?? {};
      const validation = validateLayerManifestV2(manifest, host);
      assert.equal(validation.valid, false, JSON.stringify(validation));
      assert.ok(validation.issues.some(({ code }) => code === testCase.expectedCode));

      const contractReport = validateLayerContractV2({
        manifest,
        host,
        trust: "untrusted",
        publication: true
      });
      assert.equal(contractReport.compatible, false, JSON.stringify(contractReport));
      assert.ok(contractReport.checks.some(({ code }) => code === testCase.expectedCode));

      const manifestPath = resolve(temporaryRoot, `${testCase.id}.json`);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const args = hostArguments(host);

      const cliValidation = run("validate", manifestPath, ...args);
      assert.equal(cliValidation.status, 1, cliValidation.stderr || cliValidation.stdout);
      const cliValidationReport = JSON.parse(cliValidation.stdout);
      assert.ok(
        cliValidationReport.issues.some(({ code }) => code === testCase.expectedCode),
        cliValidation.stdout
      );
      if (testCase.expectedCode === "MISSING_HOST_CAPABILITIES") {
        assert.match(cliValidation.stdout, /routing-pro/);
        assert.match(cliValidation.stdout, /weather-pro/);
      }

      const cliContract = run("contract", manifestPath, ...args);
      assert.equal(cliContract.status, 1, cliContract.stderr || cliContract.stdout);
      const cliContractReport = JSON.parse(cliContract.stdout);
      assert.ok(
        cliContractReport.checks.some(({ code }) => code === testCase.expectedCode),
        cliContract.stdout
      );
    });
  }
});
