import type {
  FilterFacet,
  LayerAttribution,
  LayerKind,
  LayerManifest,
  LayerMode,
  ViewportCost
} from "../types.js";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION
} from "../v2/common.js";
import type {
  DetailManifestV2,
  FilterFacetV2,
  GeometryKindV2,
  LayerManifestV2,
  LayerCapabilityV2,
  LayerModeV2,
  LegendManifestV2,
  RendererDescriptorV2
} from "../v2/layer.js";

export interface LayerV1AdapterOptions {
  kind: LayerKind;
  filters?: FilterFacet[];
  attribution?: LayerAttribution[];
  viewportCost?: ViewportCost;
  /** A legend is a v2 idea, but a raster overlay registered the v1 way needs one just as much:
   *  a map of coloured lines nobody can read is decoration. Passed as an adapter option rather
   *  than added to the v1 manifest, which stays frozen. */
  legend?: LegendManifestV2;
  /** Likewise for the detail sheet: without a field order the sheet falls back to the generic
   *  place layout and drops everything the provider actually sent. */
  detail?: DetailManifestV2;
  /** Capabilities the layer has beyond what the kind implies — `media` for a layer whose
   *  features carry photos, `detail` for one worth opening. The derived set covers query,
   *  filter and temporal, which are the only ones the v1 shape can prove on its own. */
  capabilities?: LayerCapabilityV2[];
}

const modeV1ToV2: Partial<Record<LayerMode, LayerModeV2>> = {
  mine: "personal",
  discover: "discover",
  planning: "planning",
  game: "game"
};

function geometryFor(kind: LayerKind): GeometryKindV2[] {
  if (kind === "raster") return ["Raster"];
  if (kind === "vector") return ["VectorTile"];
  if (kind === "custom-gl") return ["CustomGL"];
  return ["Point"];
}

function rendererFor(kind: LayerKind): RendererDescriptorV2 {
  if (kind === "raster") return { type: "raster" };
  if (kind === "vector") return { type: "vector-style" };
  if (kind === "custom-gl") return { type: "custom-gl" };
  return { type: "circles" };
}

export function layerV1ToV2(
  manifest: LayerManifest,
  options: LayerV1AdapterOptions
): LayerManifestV2 {
  const modes = [...new Set((manifest.modes ?? []).flatMap((mode) => modeV1ToV2[mode] ?? []))];
  const filters: FilterFacetV2[] | undefined = options.filters?.map((filter) => ({ ...filter }));
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    color: manifest.color,
    category: manifest.category,
    ...(modes.length ? { modes } : {}),
    geometryKinds: geometryFor(options.kind),
    renderer: rendererFor(options.kind),
    source: { type: "custom-runtime" },
    queryPolicy: {
      strategy: options.kind === "pins" ? "viewport" : "manual",
      maxResultsPerViewport: 100,
      searchHere: options.viewportCost === "cheap" ? "never" : "after-pan"
    },
    ...(filters?.length ? { filters } : {}),
    attribution: (options.attribution?.length ? options.attribution : [{ label: "MapOS" }]).map(
      (entry) => ({ ...entry })
    ),
    capabilities: [
      ...new Set<LayerCapabilityV2>([
        ...(options.kind === "pins" ? (["query"] as const) : []),
        ...(filters?.length ? (["filter"] as const) : []),
        ...(manifest.temporal ? (["temporal"] as const) : []),
        ...(options.detail ? (["detail"] as const) : []),
        ...(options.capabilities ?? [])
      ])
    ],
    ...(manifest.requiresCapability
      ? { requiresServerCapabilities: [manifest.requiresCapability] }
      : {}),
    ...(manifest.temporal ? { temporal: { enabled: true } } : {}),
    ...(options.legend ? { legend: options.legend } : {}),
    ...(options.detail ? { detail: options.detail } : {}),
    compatibility: {
      legacyLayerId: manifest.id,
      legacyAdapter: "layerV1ToV2",
      migrationNotes: "Adapted by the host; the v1 runtime contract remains active."
    }
  };
}
