import { createHash } from "node:crypto";
import type { Bbox } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { point, withinBbox, type DataSource } from "./types.js";
type Entry = {
  url?: string;
  valid?: boolean;
  lastSeen?: number;
  data?: {
    space?: string;
    url?: string;
    location?: { lat?: number; lon?: number; address?: string };
    state?: { open?: boolean };
  };
};
export function spaceFeatures(rows: Entry[], bbox: Bbox, now = Date.now()) {
  return rows.flatMap((row) => {
    const d = row.data,
      lat = d?.location?.lat,
      lon = d?.location?.lon;
    if (
      !row.valid ||
      !d?.space ||
      !row.url ||
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !withinBbox(bbox, lon, lat)
    )
      return [];
    const fresh =
      typeof row.lastSeen === "number" &&
      now - row.lastSeen * 1000 >= 0 &&
      now - row.lastSeen * 1000 < 10 * 60000;
    return [
      point(
        `spaceapi:${createHash("sha256").update(row.url).digest("hex").slice(0, 24)}`,
        d.space,
        lon,
        lat,
        "makerspaces",
        {
          category: "makerspace",
          address: d.location?.address,
          website: d.url,
          source: "SpaceAPI · provozovatel prostoru",
          sourceUrl: row.url,
          reportedAt:
            typeof row.lastSeen === "number"
              ? new Date(row.lastSeen * 1000).toISOString()
              : undefined,
          availability:
            fresh && typeof d.state?.open === "boolean"
              ? d.state.open
                ? "Otevřeno podle hlášení provozovatele"
                : "Zavřeno podle hlášení provozovatele"
              : "Aktuální stav neověřen",
          description:
            "Hackerspace / makerspace; není automaticky veřejným coworkingem. Podmínky vstupu ověřte u provozovatele."
        }
      )
    ];
  });
}
export const makerspaces: DataSource = {
  id: "makerspaces",
  async load(bbox, _query, signal) {
    const rows = await fetchJson<Entry[]>("https://api.spaceapi.io/", {
      providerId: "spaceapi",
      signal,
      ttlMs: 300000,
      timeoutMs: 10000,
      maxResponseBytes: 4 * 1024 * 1024
    });
    return spaceFeatures(rows, bbox);
  }
};
