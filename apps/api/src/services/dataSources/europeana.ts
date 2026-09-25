import type { Bbox } from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { fetchJson } from "../../utils/upstream.js";
import { bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";
type RecordItem = {
  id?: string;
  title?: string[];
  edmPlaceLatitude?: string[];
  edmPlaceLongitude?: string[];
  year?: string[];
  dataProvider?: string[];
  rights?: string[];
};
export function europeanaFeatures(items: RecordItem[], bbox: Bbox) {
  return items.flatMap((p) => {
    // Search flattens multiple EDM Place entities into separate arrays. Those arrays cannot
    // safely be zipped: accept only one distinct latitude AND longitude, never invent pairs.
    const lats = [...new Set(p.edmPlaceLatitude ?? [])],
      lons = [...new Set(p.edmPlaceLongitude ?? [])];
    if (!p.id || lats.length !== 1 || lons.length !== 1 || !lats[0]?.trim() || !lons[0]?.trim())
      return [];
    const lat = Number(lats[0]),
      lon = Number(lons[0]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !withinBbox(bbox, lon, lat)
    )
      return [];
    return [
      point(`europeana:${p.id}`, p.title?.[0] ?? "Kulturní záznam", lon, lat, "europeana", {
        category: "cultural-record",
        year: p.year?.join(", "),
        dataProvider: p.dataProvider?.join(", "),
        objectRights: p.rights?.join(", "),
        source: "Europeana a poskytovatel záznamu · metadata CC0",
        sourceUrl: `https://www.europeana.eu/item${p.id}`,
        description:
          "Místo uvedené v metadatech kulturního záznamu, nikoli automaticky poloha muzea nebo dnešní umístění předmětu. Práva digitálního objektu jsou uvedena samostatně."
      })
    ];
  });
}
export function europeanaRecordFeatures(
  record: {
    object?: {
      places?: {
        about?: string;
        latitude?: number;
        longitude?: number;
        prefLabel?: Record<string, string[]>;
      }[];
    };
  },
  item: RecordItem,
  bbox: Bbox
) {
  const seen = new Set<string>();
  return (record.object?.places ?? []).flatMap((place) => {
    const lat = place.latitude,
      lon = place.longitude;
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !withinBbox(bbox, lon, lat)
    )
      return [];
    const key = `${lon}:${lat}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const label =
      place.prefLabel?.cs?.[0] ??
      place.prefLabel?.en?.[0] ??
      Object.values(place.prefLabel ?? {}).flat()[0] ??
      "zeměpisný odkaz";
    const features = europeanaFeatures(
      [{ ...item, edmPlaceLatitude: [String(lat)], edmPlaceLongitude: [String(lon)] }],
      bbox
    );
    return features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        id: `${f.properties.id}:${key}`,
        name: `${item.title?.[0] ?? "Kulturní záznam"} · ${label}`,
        relatedPlace: label
      }
    }));
  });
}
export const europeana: DataSource = {
  id: "europeana",
  tooLarge: (bbox) => (bboxSpanKm(bbox) > 100 ? "Přibližte mapu na oblast do 100 km." : null),
  async load(bbox, _query, signal) {
    const key = config.layerKeys.europeana;
    if (!key) throw new Error("Europeana není nakonfigurovaná");
    const params = new URLSearchParams({ wskey: key, query: "*:*", rows: "100", profile: "rich" });
    params.append("qf", `pl_wgs84_pos_lat:[${bbox[1]} TO ${bbox[3]}]`);
    params.append("qf", `pl_wgs84_pos_long:[${bbox[0]} TO ${bbox[2]}]`);
    const data = await fetchJson<{ items?: RecordItem[] }>(
      `https://api.europeana.eu/record/v2/search.json?${params}`,
      {
        providerId: "europeana",
        signal,
        ttlMs: 3600000,
        timeoutMs: 12000,
        maxResponseBytes: 8 * 1024 * 1024,
        retries: 0
      }
    );
    const items = data.items ?? [];
    const features = europeanaFeatures(items, bbox);
    // A flattened search result often has several places. Resolve a small number of full
    // EDM records instead of pairing unrelated latitude / longitude arrays.
    const ambiguous = items
      .filter(
        (item) => item.id && !features.some((f) => f.properties.id === `europeana:${item.id}`)
      )
      .slice(0, 8);
    for (let offset = 0; offset < ambiguous.length; offset += 4) {
      signal?.throwIfAborted();
      const batch = await Promise.allSettled(
        ambiguous.slice(offset, offset + 4).map(async (item) => {
          const id = item.id!;
          if (!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_%.-]+$/.test(id)) return [];
          const record = await fetchJson<Parameters<typeof europeanaRecordFeatures>[0]>(
            `https://api.europeana.eu/record/v2${id}.json?${new URLSearchParams({ wskey: key })}`,
            {
              providerId: "europeana",
              signal,
              ttlMs: 86400000,
              timeoutMs: 8000,
              maxResponseBytes: 2 * 1024 * 1024,
              retries: 0
            }
          );
          return europeanaRecordFeatures(record, item, bbox);
        })
      );
      for (const row of batch) if (row.status === "fulfilled") features.push(...row.value);
    }
    return {
      features,
      status: "partial",
      notice:
        "Výběr kulturních záznamů a jejich zeměpisných souvislostí. Místo odkazu není automaticky dnešním umístěním předmětu. Výběr je omezený, nikoli úplný soupis památek."
    };
  }
};
