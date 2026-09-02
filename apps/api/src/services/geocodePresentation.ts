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
    display_name: item.label || item.name,
    lat: String(item.position.lat),
    lon: String(item.position.lon),
    type: item.type || "place",
    hierarchy: cleanParts([
      ...(item.regionalStructure ?? []).map((part) => part.name),
      item.location
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
