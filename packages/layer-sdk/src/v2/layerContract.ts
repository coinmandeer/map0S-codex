import type { JsonValue } from "./common.js";
import type { LayerManifestV2 } from "./layer.js";
import type { FeatureQueryV2, FeatureQueryResultV2 } from "./query.js";
import { normalizeFeatureLimit } from "./query.js";
import {
  validateLayerManifestV2,
  type LayerHostCompatibilityV2,
  type LayerManifestValidationIssueCodeV2
} from "./layerManifestValidation.js";
import { assertDeclarativeHttpSourceV2, assertFeatureQueryResultV2 } from "./validation.js";
import { MAPOS_V2_SCHEMA_VERSION } from "./common.js";

export type LayerContractCheckStatusV2 = "passed" | "failed" | "warning";

export interface LayerContractCheckV2 {
  id: string;
  status: LayerContractCheckStatusV2;
  message: string;
  code?: LayerManifestValidationIssueCodeV2;
  path?: string;
}

export interface LayerContractReportV2 {
  schema: "mapos.layer-contract-report";
  schemaVersion: "2.0.0";
  layerId: string;
  compatible: boolean;
  checks: LayerContractCheckV2[];
}

export interface LayerContractAdapterV2 {
  query(query: FeatureQueryV2, signal: AbortSignal): Promise<FeatureQueryResultV2>;
}

export interface RunLayerContractOptionsV2 {
  manifest: LayerManifestV2;
  fixture?: FeatureQueryResultV2;
  adapter?: LayerContractAdapterV2;
  query?: FeatureQueryV2;
  trust?: "untrusted" | "reviewed-server" | "trusted-ui";
  publication?: boolean;
  timeoutMs?: number;
  host?: LayerHostCompatibilityV2;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function containsLikelySecret(value: unknown, key = ""): boolean {
  if (/^(?:authorization|api[-_]?key|secret|password|token)$/i.test(key)) return true;
  if (typeof value === "string") {
    return /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,})/.test(value);
  }
  if (Array.isArray(value)) return value.some((entry) => containsLikelySecret(entry));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([entryKey, entry]) =>
      containsLikelySecret(entry, entryKey)
    );
  }
  return false;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(
  checks: LayerContractCheckV2[],
  id: string,
  condition: boolean,
  success: string,
  failure: string,
  warning = false
) {
  checks.push({
    id,
    status: condition ? "passed" : warning ? "warning" : "failed",
    message: condition ? success : failure
  });
}

function publicationReady(manifest: unknown): boolean {
  if (!record(manifest) || !Array.isArray(manifest.attribution)) return false;
  return (
    manifest.attribution.length > 0 &&
    manifest.attribution.every(
      (entry) =>
        record(entry) &&
        typeof entry.label === "string" &&
        Boolean(entry.label.trim()) &&
        typeof entry.license === "string" &&
        Boolean(entry.license.trim())
    )
  );
}

function validateFixture(
  checks: LayerContractCheckV2[],
  manifest: LayerManifestV2,
  fixture: FeatureQueryResultV2
) {
  try {
    assertFeatureQueryResultV2(fixture);
    add(checks, "fixture-shape", true, "Fixture matches FeatureQueryResult v2.", "");
  } catch (error) {
    add(
      checks,
      "fixture-shape",
      false,
      "",
      error instanceof Error ? error.message : "Fixture is invalid."
    );
    return;
  }
  add(
    checks,
    "feature-budget",
    fixture.data.features.length <= normalizeFeatureLimit(fixture.meta.limit),
    "Fixture stays within the feature budget.",
    "Fixture exceeds its declared feature budget."
  );
  add(
    checks,
    "layer-ownership",
    fixture.data.features.every((feature) => feature.properties.layerIds.includes(manifest.id)),
    "Every fixture feature belongs to the manifest layer.",
    "A fixture feature does not include the manifest layer id."
  );
  add(
    checks,
    "source-rights",
    fixture.data.features.every((feature) =>
      feature.sources.every(
        (source) => Boolean(source.attribution?.trim()) && source.rights !== "unknown"
      )
    ),
    "Every source declares attribution and rights metadata.",
    "A source has missing attribution or unknown rights; this is advisory in the prototype.",
    true
  );
}

function baseReport(options: RunLayerContractOptionsV2): {
  report: LayerContractReportV2;
  checks: LayerContractCheckV2[];
} {
  const checks: LayerContractCheckV2[] = [];
  const manifestValidation = validateLayerManifestV2(options.manifest, options.host);
  const rawManifest: Record<string, unknown> = record(options.manifest) ? options.manifest : {};
  const rawSource: Record<string, unknown> = record(rawManifest.source) ? rawManifest.source : {};
  if (manifestValidation.valid) {
    add(checks, "manifest", true, "Manifest matches LayerManifest v2.", "");
  } else {
    manifestValidation.issues.forEach((issue, index) => {
      checks.push({
        id: index === 0 ? "manifest" : `manifest:${index + 1}`,
        status: "failed",
        message: `[${issue.code}] ${issue.message}`,
        code: issue.code,
        path: issue.path
      });
    });
    if (manifestValidation.issues.length === 0) {
      add(checks, "manifest", false, "", "Manifest is invalid.");
    }
  }
  const trust = options.trust ?? "untrusted";
  const unsafeRuntime = ["server-adapter", "custom-runtime"].includes(String(rawSource.type));
  add(
    checks,
    "trust-boundary",
    trust !== "untrusted" || !unsafeRuntime,
    "Source type is permitted at this trust level.",
    "Untrusted layers cannot execute server adapters or custom runtime code."
  );
  if (rawSource.type === "declarative-http") {
    try {
      assertDeclarativeHttpSourceV2(rawSource);
      add(
        checks,
        "declarative-source",
        true,
        "Declarative source is data-only and proxy-bound.",
        ""
      );
    } catch (error) {
      add(
        checks,
        "declarative-source",
        false,
        "",
        error instanceof Error ? error.message : "Declarative source is unsafe."
      );
    }
  }
  add(
    checks,
    "secret-scan",
    !containsLikelySecret(options.manifest),
    "Manifest contains no likely credential material.",
    "Manifest contains a likely secret; use an opaque authRef."
  );
  if (options.publication) {
    add(
      checks,
      "publication-metadata",
      publicationReady(rawManifest),
      "Attribution and licence metadata is available for review.",
      "Attribution or licence metadata is incomplete; publication remains available in the prototype.",
      true
    );
  }
  if (options.fixture && manifestValidation.schemaValid) {
    validateFixture(checks, options.manifest, options.fixture);
  }
  const report: LayerContractReportV2 = {
    schema: "mapos.layer-contract-report",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    layerId: typeof rawManifest.id === "string" ? rawManifest.id : "unknown",
    compatible: false,
    checks
  };
  return { report, checks };
}

export function validateLayerContractV2(options: RunLayerContractOptionsV2): LayerContractReportV2 {
  const { report, checks } = baseReport(options);
  report.compatible = checks.every((check) => check.status !== "failed");
  return report;
}

function defaultQuery(manifest: LayerManifestV2): FeatureQueryV2 {
  return {
    bbox: [14.3, 50, 14.5, 50.2],
    zoom: 12,
    filters: {},
    limit: manifest.queryPolicy.maxResultsPerViewport ?? 20
  };
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error("Contract adapter timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

/** Executes deterministic fixture, timeout and cancellation checks without requiring a network. */
export async function runLayerContractV2(
  options: RunLayerContractOptionsV2
): Promise<LayerContractReportV2> {
  const { report, checks } = baseReport(options);
  if (checks.some((check) => check.id.startsWith("manifest") && check.status === "failed")) {
    report.compatible = false;
    return report;
  }
  if (!options.adapter) {
    add(
      checks,
      "adapter-runtime",
      Boolean(options.fixture),
      "Static fixture contract completed without an adapter.",
      "Provide a fixture or adapter for runtime contract checks."
    );
    report.compatible = checks.every((check) => check.status !== "failed");
    return report;
  }
  const query = options.query ?? defaultQuery(options.manifest);
  const timeoutMs = Math.min(5_000, Math.max(50, options.timeoutMs ?? 1_000));
  try {
    const first = await bounded(
      options.adapter.query(query, new AbortController().signal),
      timeoutMs
    );
    const second = await bounded(
      options.adapter.query(query, new AbortController().signal),
      timeoutMs
    );
    validateFixture(checks, options.manifest, first);
    add(
      checks,
      "deterministic-mapping",
      canonical(first) === canonical(second),
      "Repeated fixture queries are deterministic.",
      "Repeated fixture queries produced different results."
    );
  } catch (error) {
    add(
      checks,
      "adapter-runtime",
      false,
      "",
      error instanceof Error ? error.message : "Adapter query failed."
    );
  }
  const controller = new AbortController();
  controller.abort();
  try {
    await bounded(options.adapter.query(query, controller.signal), timeoutMs);
    add(checks, "cancellation", false, "", "Adapter ignored an already aborted signal.");
  } catch {
    add(checks, "cancellation", true, "Adapter rejects cancelled work.", "");
  }
  report.compatible = checks.every((check) => check.status !== "failed");
  return report;
}

/** Public utility for stable comparison/report snapshots. */
export function canonicalLayerJsonV2(value: JsonValue): string {
  return canonical(value);
}
