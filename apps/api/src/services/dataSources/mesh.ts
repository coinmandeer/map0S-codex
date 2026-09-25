import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

/** MeshCore LoRa mesh nodes, from the community MeshCore Analyzer.
 *
 *  The analyzer already aggregates observer uploads over MQTT, so we read its public JSON
 *  endpoint instead of standing up a broker of our own. One small document lists every node in
 *  the network; the viewport then selects the ones worth drawing. Node positions are what their
 *  operators advertise, and stale nodes stay visible on purpose — an offline repeater is still a
 *  place on the map. */
interface MeshNode {
  name?: string;
  public_key?: string;
  lat?: number;
  lon?: number;
  role?: string;
  last_seen?: string;
  last_heard?: string;
  relay_count_24h?: number;
  coverage_score?: number;
  advert_count?: number;
  usefulness_grade?: string;
}

const ANALYZER_URL = "https://analyzer.meshcore.cz/api/nodes";

export const meshcore: DataSource = {
  id: "meshcore",
  v2: {
    providerId: "meshcore",
    attribution: "MeshCore Analyzer (meshcore.cz)",
    license: "community data",
    rights: "open",
    confidence: 0.8,
    kind: "place"
  },
  // The endpoint returns the whole network at once, so there is no upstream reason to refuse a
  // wide viewport. The guard is only there to keep the reply small enough to be pleasant.
  tooLarge: (bbox: Bbox) =>
    bboxSpanKm(bbox) > 2500 ? "Přibliž mapu — MeshCore síť se načítá pro menší výřez." : null,
  async load(bbox, _query, signal) {
    const data = await fetchJson<{ nodes?: MeshNode[] }>(ANALYZER_URL, {
      providerId: "meshcore",
      signal,
      ttlMs: 5 * 60_000,
      timeoutMs: 12_000,
      maxResponseBytes: 4 * 1024 * 1024
    });
    return (data.nodes ?? []).flatMap((node): GeoFeature[] => {
      if (typeof node.lat !== "number" || typeof node.lon !== "number") return [];
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) return [];
      if (!withinBbox(bbox, node.lon, node.lat)) return [];
      const key = node.public_key ?? `${node.lat},${node.lon}`;
      return [
        point(`meshcore:${key}`, node.name ?? "MeshCore node", node.lon, node.lat, "meshcore", {
          category: "meshcore",
          role: node.role,
          lastSeen: node.last_seen ?? node.last_heard,
          relayCount24h: node.relay_count_24h,
          coverage: node.coverage_score,
          advertCount: node.advert_count,
          usefulnessGrade: node.usefulness_grade,
          publicKey: node.public_key
        })
      ];
    });
  }
};
