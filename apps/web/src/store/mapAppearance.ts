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

/**
 * What identifies a preset's configuration, for noticing that the user has drifted from it.
 * A layer's time window (`from`/`to`) is where the timeline is looking, written as absolute dates:
 * it moves with the calendar and the scrubber, not with the preset. Counting it made any preset
 * with events fall back to "Custom" the moment the timeline filled in this week.
 */
export function presetAppearanceKey(value: MapAppearance): string {
  const layers = Object.fromEntries(
    Object.entries(value.layers).map(([id, entry]) => {
      if (!entry.filters || !("from" in entry.filters || "to" in entry.filters)) return [id, entry];
      const filters = { ...entry.filters };
      delete filters.from;
      delete filters.to;
      return [id, { ...entry, filters }];
    })
  );
  return appearanceKey({ ...value, layers });
}
