import type { Bbox } from "@mapos/layer-sdk";

import { aisCollector } from "./aisStream.js";
import { digitrafficVessels } from "./digitraffic.js";
import { AISSTREAM, type LiveTrafficResult } from "./types.js";

export { aircraftInView } from "./adsbLol.js";
export { aisCollector } from "./aisStream.js";
export { digitrafficVessels } from "./digitraffic.js";
export { ADSB_LOL, AISSTREAM, DIGITRAFFIC } from "./types.js";
export type { LiveTrafficResult, LiveTrafficSource } from "./types.js";

/**
 * Live vessels: AISstream when the deployment has a key (worldwide), Digitraffic otherwise
 * (Finnish waters, keyless and clearly licensed). The layer exists either way; only the
 * coverage statement changes.
 */
export async function vesselsInView(bbox: Bbox, signal?: AbortSignal): Promise<LiveTrafficResult> {
  if (!aisCollector.status.configured) return digitrafficVessels(bbox, signal);
  signal?.throwIfAborted();
  aisCollector.requestArea(bbox);
  const result = aisCollector.vessels(bbox);
  // The global stream can legitimately have nothing for a viewport; say so rather than letting
  // an empty layer look broken, and do not silently fall back to a regional source with a
  // different licence.
  if (!result.features.length && !result.notice)
    return {
      ...result,
      status: "partial",
      notice:
        "AISstream v tomto okně zatím žádnou loď nezachytil. Prázdná mapa neznamená, že tu nic není."
    };
  return { ...result, source: result.source ?? AISSTREAM };
}
