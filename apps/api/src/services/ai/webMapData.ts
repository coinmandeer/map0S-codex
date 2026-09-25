import { createHash } from "node:crypto";
import type { MapResultDraft } from "@mapos/layer-sdk";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

/** A model extracts rows; only fetched text and geocoder-owned coordinates become a map. */
export const WEB_MAP_DATA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "unit", "time", "rows"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    unit: { type: "string", minLength: 1, maxLength: 80 },
    time: { type: "string", minLength: 1, maxLength: 80 },
    rows: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["placeName", "value", "sourceUrl", "quote"],
        properties: {
          placeId: { type: "string", minLength: 1, maxLength: 128 },
          placeName: { type: "string", minLength: 2, maxLength: 120 },
          value: { type: "number" },
          sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
          quote: { type: "string", minLength: 5, maxLength: 600 }
        }
      }
    }
  }
} as const;
const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
export function webMapData(
  raw: unknown,
  places: ReadonlyMap<string, AiPlaceSearchRecord>,
  pages: ReadonlyMap<string, string>
): MapResultDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as { title?: unknown; unit?: unknown; time?: unknown; rows?: unknown };
  if (
    typeof d.title !== "string" ||
    typeof d.unit !== "string" ||
    typeof d.time !== "string" ||
    !d.title ||
    !d.unit ||
    !d.time ||
    !Array.isArray(d.rows) ||
    d.rows.length > 20
  )
    return null;
  const features: MapResultDraft["data"]["features"] = [],
    sources = new Map<string, MapResultDraft["sources"][number]>();
  for (const row of d.rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (
      typeof r.placeId !== "string" ||
      typeof r.placeName !== "string" ||
      typeof r.sourceUrl !== "string" ||
      typeof r.quote !== "string" ||
      typeof r.value !== "number" ||
      !Number.isFinite(r.value)
    )
      return null;
    const place = places.get(r.placeId),
      page = pages.get(r.sourceUrl),
      quote = normalize(r.quote),
      name = normalize(r.placeName);
    if (
      !place ||
      !page ||
      name.length < 2 ||
      !normalize(place.title).includes(name) ||
      !quote.includes(name) ||
      !normalize(page).includes(quote) ||
      !normalize(page).includes(normalize(d.unit)) ||
      !normalize(page).includes(normalize(d.time))
    )
      return null;
    // Parse a complete number token, rather than accepting 2 because a quote contains 2024.
    const numbers = r.quote.match(/-?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?/g) ?? [];
    if (!numbers.some((n) => Number(n.replace(/[ \u00a0]/g, "").replace(",", ".")) === r.value))
      return null;
    if (features.some((f) => f.id === place.id)) return null;
    const sourceId = `web-${createHash("sha256").update(r.sourceUrl).digest("hex").slice(0, 24)}`;
    sources.set(sourceId, { id: sourceId, label: r.sourceUrl, url: r.sourceUrl });
    features.push({
      type: "Feature",
      id: place.id,
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
      properties: { title: place.title, sourceId, value: r.value }
    });
  }
  if (!features.length) return null;
  const values = features.map((f) => f.properties.value as number);
  return {
    id: `web-data-${createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 24)}`,
    title: d.title,
    data: { type: "FeatureCollection", features },
    style: {
      palette: "blue",
      opacity: 0.9,
      ...(Math.min(...values) < Math.max(...values)
        ? { minimum: Math.min(...values), maximum: Math.max(...values) }
        : {})
    },
    sources: [...sources.values()],
    legend: {
      title: `${d.title} · údaje vyčtené z citovaného zdroje`,
      unit: d.unit,
      time: d.time,
      noDataLabel: "Neuvedená místa nejsou nulové hodnoty; výběr není úplný žebříček"
    }
  };
}
