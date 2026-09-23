import type { StatDatasetDescriptor } from "@mapos/adapter-sdk";

/** One resolution policy for metadata, tiles and tables. Only pass published, allowed candidates. */
export function selectDataset<T>(
  entries: readonly T[],
  descriptor: (entry: T) => StatDatasetDescriptor | undefined,
  zoom = 6
): T | undefined {
  const levels =
    zoom < 4
      ? ["country", "nuts0", "nuts1", "nuts2", "nuts3", "adm1", "lau"]
      : zoom < 6
        ? ["nuts1", "nuts2", "nuts3", "adm1", "country", "nuts0", "lau"]
        : zoom < 8
          ? ["nuts3", "nuts2", "adm1", "nuts1", "country", "nuts0", "lau"]
          : ["lau", "nuts3", "nuts2", "adm1", "nuts1", "country", "nuts0"];
  return levels
    .map((level) => entries.find((entry) => descriptor(entry)?.geoLevel === level))
    .find(Boolean);
}
