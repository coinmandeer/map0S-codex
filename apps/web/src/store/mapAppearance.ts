import type { FilterValues, PlaceSourceId } from "@mapos/layer-sdk";
export interface MapAppearance {
  layers: Record<
    string,
    { visible: boolean; selected?: boolean; opacity: number; filters: FilterValues }
  >;
  basemapId: string;
  basemapLabels: boolean;
  buildings3d: boolean;
  terrain3d: boolean;
  poiSources: Record<PlaceSourceId, boolean>;
}
export function appearanceKey(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(appearanceKey).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + appearanceKey(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
