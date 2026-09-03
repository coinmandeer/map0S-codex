import type { ErrorObject, ValidateFunction } from "ajv";
import type { LayerManifestV2 } from "./layer.js";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_VERSION,
  MAPOS_V2_SUPPORTED_MAJOR,
  parseSchemaVersion
} from "./common.js";
import generatedLayerManifestValidator from "./layerManifestValidator.generated.js";

export type LayerManifestValidationIssueCodeV2 =
  | "SCHEMA_INVALID"
  | "UNSUPPORTED_SCHEMA_MAJOR"
  | "INVALID_SDK_RANGE"
  | "UNSUPPORTED_SDK_RANGE"
  | "INVALID_MINIMUM_RUNTIME"
  | "MINIMUM_RUNTIME_NOT_MET"
  | "MISSING_HOST_CAPABILITIES";

export interface LayerManifestValidationIssueV2 {
  code: LayerManifestValidationIssueCodeV2;
  path: string;
  message: string;
  details?: Record<string, string | number | string[]>;
}

export interface LayerHostCompatibilityV2 {
  /** SDK version exposed by the host. Defaults to this package's public SDK version. */
  sdkVersion?: string;
  /** MapOS release/runtime version. Defaults to the current host runtime. */
  runtimeVersion?: string;
  /** When supplied, every required server capability is checked. Omit for shape-only tooling. */
  availableCapabilities?: Iterable<string>;
}

export interface LayerManifestValidationResultV2 {
  valid: boolean;
  schemaValid: boolean;
  compatible: boolean;
  issues: LayerManifestValidationIssueV2[];
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

interface RangeResult {
  valid: boolean;
  satisfies: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function endpointIsCredentialFreeHttps(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash &&
      (!endpoint.port || endpoint.port === "443")
    );
  } catch {
    return false;
  }
}

/**
 * AJV's compiler uses `new Function`, which an enforcing production CSP correctly rejects.
 * Generation happens in a trusted build step; browser, server and CLI all execute this exact
 * checked-in validator without runtime code generation.
 */
const validateLayerManifestSchema = generatedLayerManifestValidator as ValidateFunction;

function schemaPath(error: ErrorObject): string {
  const missing =
    error.keyword === "required" && typeof error.params.missingProperty === "string"
      ? `/${error.params.missingProperty}`
      : "";
  return `${error.instancePath}${missing}` || "/";
}

function displayPath(path: string): string {
  return path === "/" ? "manifest" : path.slice(1).replaceAll("/", ".");
}

function schemaMessage(error: ErrorObject): string {
  const path = schemaPath(error);
  if (path === "/source/endpoint") {
    return "source.endpoint must be an absolute, credential-free HTTPS URL on the default port.";
  }
  if (error.keyword === "additionalProperties") {
    const property = String(error.params.additionalProperty ?? "unknown");
    return `${displayPath(error.instancePath || "/")} contains unsupported property "${property}".`;
  }
  if (error.keyword === "required") return `${displayPath(path)} is required.`;
  return `${displayPath(path)} ${error.message ?? "does not match the public schema"}.`;
}

function parseVersion(value: string): Semver | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0)
  };
}

function compare(left: Semver, right: Semver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function partialPrecision(value: string): number {
  return value.replace(/^v/, "").split(".").length;
}

function satisfiesComparator(version: Semver, operator: string, target: Semver): boolean {
  const compared = compare(version, target);
  if (operator === ">") return compared > 0;
  if (operator === ">=") return compared >= 0;
  if (operator === "<") return compared < 0;
  if (operator === "<=") return compared <= 0;
  return compared === 0;
}

/** A deliberately small, documented SemVer subset: exact/partial, ^, ~, wildcard and AND ranges. */
function satisfiesRange(versionValue: string, rangeValue: string): RangeResult {
  const version = parseVersion(versionValue);
  const range = rangeValue.trim();
  if (!version || !range || range.includes("||")) return { valid: false, satisfies: false };
  if (range === "*") return { valid: true, satisfies: true };

  const comparators = [...range.matchAll(/(>=|<=|>|<)\s*(v?\d+(?:\.\d+){0,2})/g)];
  if (comparators.length) {
    const consumed = comparators
      .map((match) => match[0])
      .join(" ")
      .replaceAll(/\s+/g, " ");
    if (consumed !== range.replaceAll(/\s+/g, " ")) return { valid: false, satisfies: false };
    return {
      valid: true,
      satisfies: comparators.every((match) => {
        const target = parseVersion(match[2]);
        return Boolean(target && satisfiesComparator(version, match[1], target));
      })
    };
  }

  const wildcard = /^(\d+)\.(?:(\d+)\.)?(?:x|\*)$/i.exec(range);
  if (wildcard) {
    const major = Number(wildcard[1]);
    const minor = wildcard[2] === undefined ? null : Number(wildcard[2]);
    return {
      valid: true,
      satisfies: version.major === major && (minor === null || version.minor === minor)
    };
  }

  const operator = range[0] === "^" || range[0] === "~" ? range[0] : null;
  const rawTarget = operator ? range.slice(1) : range;
  const target = parseVersion(rawTarget);
  if (!target) return { valid: false, satisfies: false };
  const precision = partialPrecision(rawTarget);

  if (operator === "^") {
    const upper: Semver =
      precision === 1 || target.major > 0
        ? { major: target.major + 1, minor: 0, patch: 0 }
        : precision === 2 || target.minor > 0
          ? { major: 0, minor: target.minor + 1, patch: 0 }
          : { major: 0, minor: 0, patch: target.patch + 1 };
    return {
      valid: true,
      satisfies: compare(version, target) >= 0 && compare(version, upper) < 0
    };
  }
  if (operator === "~") {
    const upper =
      precision === 1
        ? { major: target.major + 1, minor: 0, patch: 0 }
        : { major: target.major, minor: target.minor + 1, patch: 0 };
    return {
      valid: true,
      satisfies: compare(version, target) >= 0 && compare(version, upper) < 0
    };
  }

  return {
    valid: true,
    satisfies:
      version.major === target.major &&
      (precision < 2 || version.minor === target.minor) &&
      (precision < 3 || version.patch === target.patch)
  };
}

function compatibilityIssues(
  value: Record<string, unknown>,
  host: LayerHostCompatibilityV2
): LayerManifestValidationIssueV2[] {
  const issues: LayerManifestValidationIssueV2[] = [];
  const sdkVersion = host.sdkVersion ?? MAPOS_LAYER_SDK_VERSION;
  const runtimeVersion = host.runtimeVersion ?? MAPOS_HOST_RUNTIME_VERSION;

  if (typeof value.schemaVersion === "string") {
    try {
      const version = parseSchemaVersion(value.schemaVersion);
      if (version.major !== MAPOS_V2_SUPPORTED_MAJOR) {
        issues.push({
          code: "UNSUPPORTED_SCHEMA_MAJOR",
          path: "/schemaVersion",
          message: `Layer schema major ${version.major} is unsupported; migrate it to v${MAPOS_V2_SUPPORTED_MAJOR} before loading.`,
          details: {
            received: value.schemaVersion,
            supportedMajor: MAPOS_V2_SUPPORTED_MAJOR
          }
        });
      }
    } catch {
      // AJV owns malformed schema-version reporting; do not duplicate it here.
    }
  }

  if (typeof value.sdkRange === "string") {
    const result = satisfiesRange(sdkVersion, value.sdkRange);
    if (!result.valid) {
      issues.push({
        code: "INVALID_SDK_RANGE",
        path: "/sdkRange",
        message: `sdkRange "${value.sdkRange}" is invalid; use an exact version, ^, ~, wildcard, or space-separated comparator range.`,
        details: { sdkRange: value.sdkRange, hostSdkVersion: sdkVersion }
      });
    } else if (!result.satisfies) {
      issues.push({
        code: "UNSUPPORTED_SDK_RANGE",
        path: "/sdkRange",
        message: `Host SDK ${sdkVersion} does not satisfy sdkRange "${value.sdkRange}"; declare a v${MAPOS_V2_SUPPORTED_MAJOR}-compatible range or upgrade the host.`,
        details: { sdkRange: value.sdkRange, hostSdkVersion: sdkVersion }
      });
    }
  }

  if (value.minimumRuntime !== undefined) {
    if (typeof value.minimumRuntime !== "string" || !parseVersion(value.minimumRuntime)) {
      issues.push({
        code: "INVALID_MINIMUM_RUNTIME",
        path: "/minimumRuntime",
        message: "minimumRuntime must use major.minor.patch notation.",
        details: { received: String(value.minimumRuntime) }
      });
    } else {
      const required = parseVersion(value.minimumRuntime)!;
      const available = parseVersion(runtimeVersion);
      if (!available || compare(available, required) < 0) {
        issues.push({
          code: "MINIMUM_RUNTIME_NOT_MET",
          path: "/minimumRuntime",
          message: `Layer requires MapOS runtime ${value.minimumRuntime} or newer, but this host is ${runtimeVersion}; upgrade the host or lower the requirement after compatibility testing.`,
          details: { minimumRuntime: value.minimumRuntime, hostRuntimeVersion: runtimeVersion }
        });
      }
    }
  }

  if (host.availableCapabilities !== undefined && Array.isArray(value.requiresServerCapabilities)) {
    const available = new Set(host.availableCapabilities);
    const missing = [
      ...new Set(
        value.requiresServerCapabilities
          .filter((capability): capability is string => typeof capability === "string")
          .filter((capability) => !available.has(capability))
      )
    ].sort();
    if (missing.length) {
      issues.push({
        code: "MISSING_HOST_CAPABILITIES",
        path: "/requiresServerCapabilities",
        message: `Host is missing required capabilities: ${missing.join(", ")}. Enable them or remove the requirements before loading this layer.`,
        details: { missingCapabilities: missing }
      });
    }
  }
  return issues;
}

/**
 * What an inline layer has to carry to be shown at all (§30.7).
 *
 * The whole point of an inline source is that nobody can look up where the points came from
 * later, so it has to say now: the manifest names its attribution, and every point names the
 * source record it was read from. A layer that cannot answer "according to whom" is not shown.
 */
function inlineSourceIssues(value: Record<string, unknown>): LayerManifestValidationIssueV2[] {
  const source = value.source as Record<string, unknown>;
  const issues: LayerManifestValidationIssueV2[] = [];
  const attribution = Array.isArray(value.attribution) ? value.attribution : [];
  if (!attribution.length) {
    issues.push({
      code: "SCHEMA_INVALID",
      path: "/attribution",
      message: "An inline layer must name at least one attribution; its data cannot be re-fetched."
    });
  }
  const inline = record(source.inline) ? source.inline : null;
  if (!inline) {
    issues.push({
      code: "SCHEMA_INVALID",
      path: "/source/inline",
      message: "source.inline is required when source.type is inline."
    });
    return issues;
  }
  if (source.endpoint !== undefined || source.tileTemplate !== undefined) {
    issues.push({
      code: "SCHEMA_INVALID",
      path: "/source/endpoint",
      message: "An inline layer has no upstream; remove endpoint and tileTemplate."
    });
  }
  const features = Array.isArray(inline.features) ? inline.features : [];
  const seen = new Set<string>();
  features.forEach((feature, index) => {
    if (!record(feature)) return;
    const id = typeof feature.id === "string" ? feature.id : "";
    if (seen.has(id)) {
      issues.push({
        code: "SCHEMA_INVALID",
        path: `/source/inline/features/${index}/id`,
        message: `Inline feature id ${id} is used twice; ids identify a point for selection.`
      });
    }
    seen.add(id);
  });
  // Provenance is what tells a saved inline layer apart from surveyed data, so an `ai` origin
  // has to name its model — "some assistant, some time" is not provenance.
  const provenance = record(inline.provenance) ? inline.provenance : null;
  if (provenance?.kind === "ai" && typeof provenance.model !== "string") {
    issues.push({
      code: "SCHEMA_INVALID",
      path: "/source/inline/provenance/model",
      message: "AI provenance must name the model that produced the layer."
    });
  }
  return issues;
}

function semanticSchemaIssues(value: Record<string, unknown>): LayerManifestValidationIssueV2[] {
  if (record(value.source) && value.source.type === "inline") return inlineSourceIssues(value);
  if (!record(value.source) || value.source.type !== "declarative-http") return [];
  if (
    typeof value.source.endpoint === "string" &&
    endpointIsCredentialFreeHttps(value.source.endpoint)
  ) {
    return [];
  }
  return [
    {
      code: "SCHEMA_INVALID",
      path: "/source/endpoint",
      message: "source.endpoint must be an absolute, credential-free HTTPS URL on the default port."
    }
  ];
}

function issuePriority(issue: LayerManifestValidationIssueV2): number {
  if (issue.code !== "SCHEMA_INVALID") return 0;
  if (issue.path === "/source/endpoint") return 10;
  return 20 + issue.path.split("/").length;
}

/** Validates both the canonical JSON schema and host compatibility without mutating input. */
export function validateLayerManifestV2(
  value: unknown,
  host: LayerHostCompatibilityV2 = {}
): LayerManifestValidationResultV2 {
  const jsonSchemaValid = validateLayerManifestSchema(value) as boolean;
  const issues: LayerManifestValidationIssueV2[] = (validateLayerManifestSchema.errors ?? []).map(
    (error) => ({
      code: "SCHEMA_INVALID",
      path: schemaPath(error),
      message: schemaMessage(error),
      details: { keyword: error.keyword }
    })
  );
  if (record(value)) issues.push(...semanticSchemaIssues(value));
  const hostIssues = record(value) ? compatibilityIssues(value, host) : [];
  issues.push(...hostIssues);
  issues.sort((left, right) => issuePriority(left) - issuePriority(right));
  const schemaValid = jsonSchemaValid && !issues.some(({ code }) => code === "SCHEMA_INVALID");
  const compatible = hostIssues.length === 0;
  return { valid: schemaValid && compatible, schemaValid, compatible, issues };
}

export class LayerManifestValidationError extends TypeError {
  readonly name = "LayerManifestValidationError";

  constructor(readonly issues: LayerManifestValidationIssueV2[]) {
    super(issues.map((issue) => `[${issue.code}] ${issue.message}`).join(" "));
  }

  toJSON() {
    return { name: this.name, message: this.message, issues: this.issues };
  }
}

export function assertLayerManifestSchemaV2(
  value: unknown,
  host: LayerHostCompatibilityV2 = {}
): asserts value is LayerManifestV2 {
  const result = validateLayerManifestV2(value, host);
  if (!result.valid) throw new LayerManifestValidationError(result.issues);
}
