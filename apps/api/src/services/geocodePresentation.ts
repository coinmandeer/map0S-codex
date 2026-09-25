import type { MapyGeocodeItem } from "./mapyService.js";

export type GeocodeConfidenceLevel = "high" | "medium" | "low";

export interface PresentedGeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  hierarchy: string[];
  source: { id: "mapy" | "openstreetmap" | "fixture"; label: string };
  confidence: {
    level: GeocodeConfidenceLevel;
    label: string;
    basis: "provider-order";
  };
}

export interface NominatimGeocodeItem {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  class?: string;
  address?: Record<string, string>;
}

const HIERARCHY_KEYS = [
  "neighbourhood",
  "suburb",
  "city_district",
  "village",
  "town",
  "city",
  "municipality",
  "county",
  "state",
  "region",
  "country"
] as const;

function cleanParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of parts) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase("cs-CZ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value.slice(0, 160));
  }
  return result.slice(0, 6);
}

export function geocodeConfidence(index: number): PresentedGeocodeResult["confidence"] {
  const rank = Math.max(0, Math.floor(index));
  if (rank === 0) return { level: "high", label: "vysoká", basis: "provider-order" };
  if (rank <= 2) return { level: "medium", label: "střední", basis: "provider-order" };
  return { level: "low", label: "nižší", basis: "provider-order" };
}

export function presentMapyGeocodeResult(
  item: MapyGeocodeItem,
  index: number
): PresentedGeocodeResult {
  return {
    display_name: item.name || item.label,
    lat: String(item.position.lat),
    lon: String(item.position.lon),
    type: item.type || "place",
    hierarchy: cleanParts([
      ...(item.location
        ? [item.location]
        : (item.regionalStructure ?? [])
            .map((part) => part.name)
            .filter((name) => name !== item.name))
    ]),
    source: { id: "mapy", label: "Mapy.com" },
    confidence: geocodeConfidence(index)
  };
}

export function presentNominatimGeocodeResult(
  item: NominatimGeocodeItem,
  index: number
): PresentedGeocodeResult {
  const address = item.address ?? {};
  return {
    display_name: item.display_name,
    lat: item.lat,
    lon: item.lon,
    type: item.addresstype || item.type || item.class || "place",
    hierarchy: cleanParts(HIERARCHY_KEYS.map((key) => address[key])),
    source: { id: "openstreetmap", label: "OpenStreetMap / Nominatim" },
    confidence: geocodeConfidence(index)
  };
}

/**
 * Reads the `near=lng,lat` search bias. Rounded to two decimals (about a kilometre): enough to
 * rank the right town first, coarse enough that the provider never learns the exact view and
 * repeated searches over one city share a cached answer. Anything malformed is simply no bias.
 */
export function parseNearPoint(value: string | undefined): [number, number] | null {
  if (!value || value.length > 64) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const [lng, lat] = parts.map((part) => Number(part.trim())) as [number, number];
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
    return null;
  return [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100];
}

/** A Nominatim `viewbox` (left,top,right,bottom) of roughly a city region around the point. */
export function nearViewbox([lng, lat]: [number, number], span = 0.3): string {
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return [
    clamp(lng - span, 180),
    clamp(lat + span, 90),
    clamp(lng + span, 180),
    clamp(lat - span, 90)
  ]
    .map((value) => Number(value.toFixed(2)))
    .join(",");
}
