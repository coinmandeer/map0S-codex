import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_VERSION,
  validateLayerManifestV2,
  type LayerManifestValidationResultV2
} from "@mapos/layer-sdk";

/** Capabilities exercised by the owner import path in this host release. */
export const OWNER_LAYER_IMPORT_HOST_CAPABILITIES = ["auth", "user-layers-v2"] as const;

export interface LayerImportManifestDeclaration {
  present: boolean;
  schema: string | null;
  schemaVersion: string | null;
  sdkRange: string | null;
  minimumRuntime: string | null;
  requiredCapabilities: string[];
}

export interface LayerImportHostInspection {
  host: {
    sdkVersion: typeof MAPOS_LAYER_SDK_VERSION;
    runtimeVersion: typeof MAPOS_HOST_RUNTIME_VERSION;
    availableCapabilities: typeof OWNER_LAYER_IMPORT_HOST_CAPABILITIES;
  };
  declaration: LayerImportManifestDeclaration;
  report: LayerManifestValidationResultV2 | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const NO_MANIFEST: LayerImportManifestDeclaration = {
  present: false,
  schema: null,
  schemaVersion: null,
  sdkRange: null,
  minimumRuntime: null,
  requiredCapabilities: []
};

/**
 * Reads only the manifest declaration needed by the owner dashboard. The compatibility verdict is
 * always produced by the public SDK validator — this helper deliberately does not implement a
 * second schema or SemVer checker in the web application.
 */
export function inspectLayerImportHostCompatibility(
  content: string,
  filename: string
): LayerImportHostInspection {
  const host = {
    sdkVersion: MAPOS_LAYER_SDK_VERSION,
    runtimeVersion: MAPOS_HOST_RUNTIME_VERSION,
    availableCapabilities: OWNER_LAYER_IMPORT_HOST_CAPABILITIES
  } as const;
  if (filename.toLowerCase().endsWith(".csv")) {
    return { host, declaration: { ...NO_MANIFEST }, report: null };
  }

  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    return { host, declaration: { ...NO_MANIFEST }, report: null };
  }
  if (!record(document) || !record(document.manifest)) {
    return { host, declaration: { ...NO_MANIFEST }, report: null };
  }

  const manifest = document.manifest;
  const requiredCapabilities = Array.isArray(manifest.requiresServerCapabilities)
    ? manifest.requiresServerCapabilities.filter(
        (capability): capability is string => typeof capability === "string"
      )
    : [];
  return {
    host,
    declaration: {
      present: true,
      schema: optionalText(manifest.schema),
      schemaVersion: optionalText(manifest.schemaVersion),
      sdkRange: optionalText(manifest.sdkRange),
      minimumRuntime: optionalText(manifest.minimumRuntime),
      requiredCapabilities
    },
    report: validateLayerManifestV2(manifest, host)
  };
}
