import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BASEMAPS,
  LABEL_OVERLAYS,
  type ExternalSourceRights,
  type LayerAttribution
} from "@mapos/layer-sdk";
import "../info/builtins";
import { allInfoPanels, registerInfoPanel } from "../info/registry";
import {
  BROWSER_EXTERNAL_SOURCE_RIGHTS,
  externalSourceForBrowserHost,
  NON_NETWORK_BROWSER_HOST_LITERALS
} from "./browserExternalSources";

const sourceRightsAudit = process.env.MAPOS_RUN_SOURCE_RIGHTS_AUDIT === "1" ? test : test.skip;

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INVENTORY_FILE = fileURLToPath(new URL("./browserExternalSources.ts", import.meta.url));
const SDK_BASEMAP_FILE = path.join(PROJECT_ROOT, "packages/layer-sdk/src/basemaps.ts");
const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const HOST_PATTERN = /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const URL_HOST_PATTERN =
  /\b(https?):\/\/((?:\{s\}|\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})/giu;

interface HostLiteral {
  protocol: "http" | "https";
  host: string;
  file: string;
  line: number;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (/\.(?:spec|test)\.[^.]+$/u.test(entry.name) || entry.name.endsWith(".d.ts")) return [];
    if (absolute === INVENTORY_FILE) return [];
    return [absolute];
  });
}

function externalHostLiterals(): HostLiteral[] {
  return [...sourceFiles(SOURCE_ROOT), SDK_BASEMAP_FILE].flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(URL_HOST_PATTERN)].map((match) => ({
      protocol: match[1]!.toLowerCase() as HostLiteral["protocol"],
      host: match[2]!.toLowerCase().replace(/^\{s\}\./u, "*."),
      file: path.relative(PROJECT_ROOT, file),
      line: source.slice(0, match.index).split("\n").length
    }));
  });
}

function hostnameFromTemplate(value: string): string {
  return new URL(value.replace(/\{[^}]+\}/gu, "0")).hostname.toLowerCase();
}

function attributionSourceIds(attribution: readonly LayerAttribution[]): Set<string> {
  return new Set(
    attribution.flatMap((entry) => {
      if (!entry.url) return [];
      const rights = externalSourceForBrowserHost(new URL(entry.url).hostname);
      return rights ? [rights.id] : [];
    })
  );
}

function assertCompleteRights(rights: ExternalSourceRights): void {
  assert.match(rights.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `${rights.id}: invalid id`);
  assert.ok(rights.label.trim(), `${rights.id}: missing label`);
  assert.ok(rights.attribution.trim(), `${rights.id}: missing attribution`);
  assert.ok(rights.terms.trim(), `${rights.id}: missing licence/terms`);
  assert.doesNotMatch(
    rights.terms,
    /^(?:n\/?a|none|tbd|unknown)$/iu,
    `${rights.id}: placeholder terms`
  );
  assert.ok(rights.hosts.length > 0, `${rights.id}: no hosts`);
  assert.ok(rights.uses.length > 0, `${rights.id}: no declared use`);
  for (const host of rights.hosts) {
    assert.match(host, HOST_PATTERN, `${rights.id}: invalid host pattern ${host}`);
  }
  const evidence = new URL(rights.evidenceUrl);
  assert.equal(evidence.protocol, "https:", `${rights.id}: evidence must use HTTPS`);
  assert.equal(evidence.username, "", `${rights.id}: evidence URL must not contain credentials`);
  assert.equal(evidence.password, "", `${rights.id}: evidence URL must not contain credentials`);
}

sourceRightsAudit("browser external-source inventory contains complete rights records", () => {
  const ids = new Set<string>();
  const exactPatterns = new Map<string, string>();

  for (const rights of BROWSER_EXTERNAL_SOURCE_RIGHTS) {
    assertCompleteRights(rights);
    assert.ok(!ids.has(rights.id), `duplicate external-source id: ${rights.id}`);
    ids.add(rights.id);
    for (const host of rights.hosts) {
      const owner = exactPatterns.get(host);
      assert.equal(owner, undefined, `${host} is assigned to both ${owner} and ${rights.id}`);
      exactPatterns.set(host, rights.id);
    }
  }
});

sourceRightsAudit(
  "every built-in provider info panel documents terms and iframe embed rights",
  () => {
    const providerPanels = allInfoPanels().filter((panel) => panel.contentOwner === "provider");
    assert.ok(providerPanels.length > 0, "built-in provider panel inventory must not be empty");

    for (const panel of providerPanels) {
      assert.ok(panel.sourceRights?.length, `${panel.id}: provider rights are missing`);
      for (const rights of panel.sourceRights ?? []) assertCompleteRights(rights);
      if (panel.kind === "iframe") {
        assert.ok(
          panel.sourceRights?.some((rights) => rights.uses.includes("embed")),
          `${panel.id}: iframe provider has no embed permission/terms record`
        );
      }
    }

    const iframeIds = providerPanels
      .filter((panel) => panel.kind === "iframe")
      .map((panel) => panel.id)
      .sort();
    assert.deepEqual(iframeIds, ["mapillary", "mapy-okoli", "windy"]);
  }
);

sourceRightsAudit("every direct SDK basemap host maps to advisory attribution metadata", () => {
  const catalogs = [...BASEMAPS, ...LABEL_OVERLAYS];
  for (const map of catalogs) {
    const directUrls = [
      ...(map.tiles ?? []),
      ...("darkTiles" in map ? (map.darkTiles ?? []) : []),
      ...("styleUrl" in map && map.styleUrl ? [map.styleUrl] : [])
    ];
    const creditedSourceIds = attributionSourceIds(map.attribution);
    for (const directUrl of directUrls) {
      const host = hostnameFromTemplate(directUrl);
      const rights = externalSourceForBrowserHost(host);
      assert.ok(rights, `${map.id}: direct host ${host} is not in the browser inventory`);
      assert.ok(
        creditedSourceIds.has(rights.id),
        `${map.id}: ${host} (${rights.id}) is not tied to a matching attribution evidence host`
      );
    }
  }
});

sourceRightsAudit("prototype provider panels are not blocked by missing rights metadata", () => {
  assert.doesNotThrow(() =>
    registerInfoPanel({
      id: "missing-rights-fixture",
      label: "Missing rights fixture",
      icon: "•",
      kind: "api",
      contentOwner: "provider",
      appliesTo: () => true,
      attribution: "Fixture",
      render: () => null
    })
  );
});

sourceRightsAudit("literal browser hosts are represented in the advisory inventory", () => {
  const sentinels = new Set<string>(NON_NETWORK_BROWSER_HOST_LITERALS);
  const missing: string[] = [];
  const insecure: string[] = [];

  for (const literal of externalHostLiterals()) {
    const location = `${literal.file}:${literal.line}`;
    if (sentinels.has(literal.host)) continue;
    if (literal.protocol !== "https") insecure.push(`${literal.host} (${location})`);
    if (!externalSourceForBrowserHost(literal.host)) missing.push(`${literal.host} (${location})`);
  }

  assert.deepEqual(insecure, [], `external browser hosts must use HTTPS:\n${insecure.join("\n")}`);
  assert.deepEqual(
    missing,
    [],
    `external browser hosts missing from browserExternalSources.ts:\n${missing.join("\n")}`
  );

  const literals = externalHostLiterals();
  const requiredCoverage = new Map([
    ["apps/web/src/info/panels/embedPanels.tsx", "embed.windy.com"],
    ["apps/web/src/layers/game/roadSource.ts", "tiles.basemaps.cartocdn.com"],
    ["apps/web/src/layers/weatherLayer.ts", "api.rainviewer.com"],
    ["apps/web/src/map/styleManager.ts", "api.mapy.com"],
    ["packages/layer-sdk/src/basemaps.ts", "tiles.maps.eox.at"]
  ]);
  for (const [file, host] of requiredCoverage) {
    assert.ok(
      literals.some((literal) => literal.file === file && literal.host === host),
      `static browser-host scan no longer covers ${host} in ${file}`
    );
  }
});
