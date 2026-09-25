import type { Bbox } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";
type Place = {
  id?: number;
  lat?: number;
  lon?: number;
  name?: string;
  address?: string;
  opening_hours?: string;
  website?: string;
  verified_at?: string;
  updated_at?: string;
  deleted_at?: string;
  osm_id?: string;
};
export function btcMapFeatures(rows: Place[], bbox: Bbox) {
  return rows.flatMap((p) => {
    if (
      !Number.isSafeInteger(p.id) ||
      p.deleted_at ||
      typeof p.lat !== "number" ||
      typeof p.lon !== "number" ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180 ||
      !withinBbox(bbox, p.lon, p.lat)
    )
      return [];
    return [
      point(`btcmap:${p.id}`, p.name || "Bitcoin místo", p.lon, p.lat, "btcmap", {
        category: "bitcoin",
        address: p.address,
        openingHours: p.opening_hours,
        website: p.website,
        verifiedAt: p.verified_at,
        updatedAt: p.updated_at,
        osmId: p.osm_id,
        source: "BTC Map / OpenStreetMap contributors",
        sourceUrl: `https://btcmap.org/merchant/${p.id}`,
        description:
          "Místo přijímající bitcoin podle BTC Map; datum ověření není zárukou aktuálního přijímání plateb."
      })
    ];
  });
}
export const btcmap: DataSource = {
  id: "btcmap",
  tooLarge: (bbox) => (bboxSpanKm(bbox) > 100 ? "Přibližte mapu na oblast do 100 km." : null),
  async load(bbox, _query, signal) {
    const c = bboxCenter(bbox);
    const params = new URLSearchParams({
      lat: String(c.lat),
      lon: String(c.lng),
      radius_km: String(Math.max(1, Math.ceil(bboxSpanKm(bbox))))
    });
    const rows = await fetchJson<Place[]>(`https://api.btcmap.org/v4/places/search/?${params}`, {
      providerId: "btcmap",
      signal,
      ttlMs: 3600000,
      timeoutMs: 10000,
      maxResponseBytes: 4 * 1024 * 1024
    });
    return btcMapFeatures(rows, bbox);
  }
};
