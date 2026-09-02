import assert from "node:assert/strict";
import test from "node:test";
import {
  BASEMAPS,
  LABEL_OVERLAYS,
  PLACE_SOURCES,
  type LayerAttribution,
  type PlaceSourceDefinition
} from "@mapos/layer-sdk";
import "./builtins";
import { allLayerPlugins } from "./registry";

const sourceRightsAudit = process.env.MAPOS_RUN_SOURCE_RIGHTS_AUDIT === "1" ? test : test.skip;

function releaseAttributionIssues(
  owner: string,
  attribution: LayerAttribution[] | undefined
): string[] {
  const issues: string[] = [];
  if (!attribution?.length) return [`${owner} has no release attribution`];
  for (const [index, entry] of attribution.entries()) {
    const prefix = `${owner} attribution[${index}]`;
    if (!entry.label.trim()) issues.push(`${prefix} has no label`);
    const licence = entry.license?.trim() ?? "";
    if (!licence) {
      issues.push(`${prefix} has no licence or governing terms identifier`);
    } else if (/^(?:unknown|unverified|none|n\/a|blocked)$/i.test(licence)) {
      issues.push(`${prefix} uses a non-evidence licence placeholder`);
    }
    if (!entry.label.startsWith("MapOS") && !entry.label.startsWith("Soukromá data")) {
      if (!/^https:\/\//.test(entry.url ?? "")) {
        issues.push(`${prefix} has no canonical HTTPS evidence URL`);
      }
    }
  }
  return issues;
}

const PLACE_SOURCE_USES = ["display", "cache", "export", "redistribute", "aiUse"] as const;
const PLACE_SOURCE_DECISIONS = new Set([
  "permitted",
  "conditional",
  "owner-controlled",
  "not-approved"
]);
const VAGUE_RIGHTS_ID = /^(?:unknown|unverified|unofficial|none|n\/a|blocked)$/i;

function placeSourceReleaseIssues(source: PlaceSourceDefinition): string[] {
  const issues: string[] = [];
  const prefix = `place-source:${source.id}`;
  const rights = source.releaseRights;

  if (!source.attribution.trim()) issues.push(`${prefix} has no attribution label`);
  if (!source.license?.trim()) {
    issues.push(`${prefix} has no human-visible governing terms identifier`);
  } else if (source.license !== rights.governingTermsId) {
    issues.push(`${prefix} attribution terms disagree with its release-rights record`);
  }
  if (!rights.governingTermsId.trim() || VAGUE_RIGHTS_ID.test(rights.governingTermsId)) {
    issues.push(`${prefix} has no exact governing terms identifier`);
  }

  for (const use of PLACE_SOURCE_USES) {
    if (!PLACE_SOURCE_DECISIONS.has(rights.permissions[use])) {
      issues.push(`${prefix} has no valid ${use} permission decision`);
    }
  }

  if (rights.state === "owner-controlled") {
    if (source.id !== "user") {
      issues.push(`${prefix} cannot use the user-data owner-controlled exception`);
    }
    if (rights.basis !== "owner-controlled") {
      issues.push(`${prefix} owner-controlled state has the wrong rights basis`);
    }
    if (rights.evidenceUrl !== null || source.url !== undefined) {
      issues.push(`${prefix} owner-controlled data must not claim a third-party evidence page`);
    }
    if (
      rights.ownerControl?.policyId !== "MAPOS-OWNER-CONTROLLED-PLACE-DATA-v1" ||
      rights.ownerControl.scope !== "per-record" ||
      rights.ownerControl.publicReleaseRequiresOwnerGrant !== true
    ) {
      issues.push(`${prefix} has no exact per-record owner-publication policy`);
    }
    for (const use of PLACE_SOURCE_USES) {
      if (rights.permissions[use] !== "owner-controlled") {
        issues.push(`${prefix} ${use} must remain owner-controlled`);
      }
    }
  } else {
    if (!/^https:\/\//.test(rights.evidenceUrl ?? "")) {
      issues.push(`${prefix} has no canonical HTTPS rights evidence URL`);
    }
    if (source.url !== rights.evidenceUrl) {
      issues.push(`${prefix} attribution URL disagrees with its rights evidence URL`);
    }
    if (rights.ownerControl !== undefined) {
      issues.push(`${prefix} cannot use the owner-controlled exception`);
    }
    for (const use of PLACE_SOURCE_USES) {
      if (rights.permissions[use] === "owner-controlled") {
        issues.push(`${prefix} cannot inherit ${use} rights from the owner-controlled exception`);
      }
    }
  }

  if (rights.state === "released") {
    if (rights.basis !== "open-license") {
      issues.push(`${prefix} released source is not based on an open licence`);
    }
    if (rights.capability !== undefined) {
      issues.push(`${prefix} released source unexpectedly depends on a legal capability`);
    }
    for (const use of PLACE_SOURCE_USES) {
      if (
        rights.permissions[use] === "not-approved" ||
        rights.permissions[use] === "owner-controlled"
      ) {
        issues.push(`${prefix} released source has no ${use} release decision`);
      }
    }
  }

  if (rights.state === "capability-gated") {
    if (rights.basis !== "service-terms" || !rights.capability) {
      issues.push(`${prefix} service-terms source has no exact server capability`);
    }
    if (rights.permissions.display === "not-approved") {
      issues.push(`${prefix} capability cannot advertise unapproved display rights`);
    }
  }

  if (rights.state === "blocked") {
    if (rights.basis !== "provider-restriction") {
      issues.push(`${prefix} blocked source has the wrong rights basis`);
    }
    if (!rights.capability) issues.push(`${prefix} blocked provider has no capability boundary`);
    for (const use of PLACE_SOURCE_USES) {
      if (rights.permissions[use] !== "not-approved") {
        issues.push(`${prefix} blocked source grants ${use} rights`);
      }
    }
  }

  if (source.id === "park4night") {
    if (
      rights.state !== "blocked" ||
      rights.governingTermsId !== "PARK4NIGHT-GTCU-ARTICLE-5-PRIOR-AUTHORIZATION-REQUIRED" ||
      rights.evidenceUrl !== "https://plus.park4night.com/en/cgu"
    ) {
      issues.push(`${prefix} is not bound to the reviewed GTCU article 5 restriction`);
    }
  }

  return issues;
}

sourceRightsAudit("advisory layer, basemap and label rights inventory is complete", () => {
  const issues: string[] = [];
  for (const basemap of BASEMAPS) {
    issues.push(...releaseAttributionIssues(`basemap:${basemap.id}`, basemap.attribution));
  }
  for (const overlay of LABEL_OVERLAYS) {
    issues.push(...releaseAttributionIssues(`label-overlay:${overlay.id}`, overlay.attribution));
  }
  for (const layer of allLayerPlugins()) {
    issues.push(...releaseAttributionIssues(`layer:${layer.manifest.id}`, layer.attribution));
  }
  assert.deepEqual(issues, []);
});

sourceRightsAudit("advisory place-source rights inventory has an exact decision", () => {
  const issues: string[] = [];
  const ids = PLACE_SOURCES.map((source) => source.id);
  if (new Set(ids).size !== ids.length) issues.push("place-source ids are not unique");
  const layers = allLayerPlugins();
  for (const source of PLACE_SOURCES) {
    issues.push(...placeSourceReleaseIssues(source));
    const sameIdLayer = layers.find((layer) => layer.manifest.id === source.id);
    if (
      sameIdLayer &&
      !sameIdLayer.attribution?.some(
        (entry) =>
          entry.license === source.releaseRights.governingTermsId &&
          entry.url === source.releaseRights.evidenceUrl
      )
    ) {
      issues.push(`layer:${source.id} disagrees with the place-source rights decision`);
    }
  }
  assert.deepEqual(issues, []);
});
