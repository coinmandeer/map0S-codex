import type { FeatureProvider } from "../featureProviders.js";
import { UpstreamError } from "../../utils/upstream.js";
import { communitySources } from "./community.js";
import { eventSources } from "./events.js";
import { keyedSources } from "./keyed.js";
import { mobilitySources } from "./mobility.js";
import { natureSources } from "./nature.js";
import { featureCollection, type DataSource } from "./types.js";

const SOURCES: DataSource[] = [
  ...natureSources,
  ...communitySources,
  ...mobilitySources,
  ...keyedSources,
  ...eventSources
];

/**
 * Wraps each bbox-in/points-out source as a feature provider.
 *
 * The refusal path matters: a viewport an upstream cannot serve returns an empty collection
 * carrying `notice`, so the UI can say "zoom in" instead of showing a layer that looks broken.
 */
export const dataSourceProviders: FeatureProvider[] = SOURCES.map((source) => ({
  id: source.id,
  name: source.id,
  kind: "pins" as const,
  async features({ bbox, query }) {
    const notice = source.tooLarge?.(bbox);
    if (notice) {
      return { ...featureCollection([]), notice };
    }
    try {
      return featureCollection(await source.load(bbox, query));
    } catch (err) {
      // One dead upstream must not take the map down with it — the layer degrades to empty
      // and says why.
      const message = err instanceof UpstreamError ? err.message : "zdroj se nepodařilo načíst";
      return { ...featureCollection([]), notice: message };
    }
  }
}));

export const dataSourceIds = SOURCES.map((s) => s.id);
