import type {
  FilterFacet,
  LayerAttribution,
  LayerCategory,
  LayerKind,
  LayerManifest,
  LayerMode
} from "../types.js";
import type { FilterFacetV2, LayerCategoryV2, LayerManifestV2 } from "../v2/layer.js";
import { assertLayerManifestV2 } from "../v2/validation.js";

const categoryFallback: Record<LayerCategoryV2, LayerCategory> = {
  travel: "travel",
  city: "community",
  sport: "outdoor",
  weather: "weather",
  events: "community",
  user: "user",
  game: "game",
  routing: "routing",
  outdoor: "outdoor",
  transport: "transport",
  environment: "environment",
  community: "community",
  infrastructure: "transport",
  moving: "transport"
};

function filterV2ToV1(filter: FilterFacetV2): FilterFacet {
  const kind: FilterFacet["kind"] =
    filter.kind === "single-select" || filter.kind === "date-range"
      ? "multi-select"
      : filter.kind === "distance"
        ? "range"
        : filter.kind;
  return {
    id: filter.id,
    label: filter.label,
    kind,
    ...(filter.options ? { options: filter.options } : {}),
    ...(filter.min !== undefined ? { min: filter.min } : {}),
    ...(filter.max !== undefined ? { max: filter.max } : {}),
    ...(filter.default !== undefined ? { default: filter.default } : {})
  };
}

export interface LayerV2LegacyView {
  manifest: LayerManifest;
  kind: LayerKind;
  filters?: FilterFacet[];
  attribution: LayerAttribution[];
}

export function layerV2ToV1(value: LayerManifestV2 | unknown): LayerV2LegacyView {
  assertLayerManifestV2(value);
  const kind: LayerKind = value.geometryKinds.includes("Raster")
    ? "raster"
    : value.geometryKinds.includes("VectorTile")
      ? "vector"
      : value.geometryKinds.includes("CustomGL")
        ? "custom-gl"
        : "pins";
  const modeMap: Record<string, LayerMode> = {
    personal: "mine",
    discover: "discover",
    planning: "planning",
    game: "game"
  };
  const modes = value.modes?.map((mode) => modeMap[mode]);
  return {
    kind,
    manifest: {
      id: value.id,
      name: value.name,
      icon: value.icon ?? "•",
      color: value.color ?? "#64748b",
      description: value.description,
      category: categoryFallback[value.category],
      ...(modes?.length ? { modes } : {}),
      ...(value.requiresServerCapabilities?.[0]
        ? { requiresCapability: value.requiresServerCapabilities[0] }
        : {}),
      temporal: value.temporal?.enabled ?? false
    },
    ...(value.filters?.length ? { filters: value.filters.map(filterV2ToV1) } : {}),
    attribution: (value.attribution ?? []).map(({ label, url, license }) => ({
      label,
      url,
      license
    }))
  };
}
