/** Registry of guide sources. Adding a second one — a tourist board's open data, a city's own
 *  API — means registering an adapter; nothing here or in the panel changes. */

import type { Guide, GuideArea, GuideSourceAdapter } from "@mapos/layer-sdk";
import { wikivoyage } from "./wikivoyage.js";

const ADAPTERS = new Map<string, GuideSourceAdapter>();

export function registerGuideSource(adapter: GuideSourceAdapter): void {
  ADAPTERS.set(adapter.id, adapter);
}

export function guideSources(): GuideSourceAdapter[] {
  return [...ADAPTERS.values()];
}

/** First source with something to say wins. Guides are editorial, so merging two of them would
 *  produce a guide nobody wrote. */
export async function getGuide(area: GuideArea, signal?: AbortSignal): Promise<Guide | null> {
  for (const adapter of guideSources()) {
    try {
      const guide = await adapter.fetchGuide(area, signal);
      if (guide?.sections.length) return guide;
    } catch {
      // A guide is a bonus on top of the map; a failing source must not fail the panel.
    }
  }
  return null;
}

registerGuideSource(wikivoyage);

export { wikivoyage };
