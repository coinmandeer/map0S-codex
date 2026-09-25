import type { ServerCapabilities } from "@mapos/layer-sdk";
export interface GeocodeHit {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  hierarchy?: string[];
  source?: { id?: string; label?: string };
}
export function maptilerHits(value: unknown): GeocodeHit[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("features" in value) ||
    !Array.isArray(value.features)
  )
    return [];
  return value.features.slice(0, 10).flatMap((feature) => {
    if (!feature || typeof feature !== "object") return [];
    const point = feature.center ?? feature.geometry?.coordinates;
    const label = feature.place_name ?? feature.text;
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 90 ||
      typeof label !== "string" ||
      !label.trim()
    )
      return [];
    return [
      {
        display_name: label.slice(0, 500),
        lon: String(point[0]),
        lat: String(point[1]),
        type:
          Array.isArray(feature.place_type) && typeof feature.place_type[0] === "string"
            ? feature.place_type[0]
            : "place",
        source: { id: "maptiler", label: "MapTiler / OpenStreetMap" }
      }
    ];
  });
}
/** Direct end-client request as required by MapTiler; no server proxy or permanent cache. */
export async function maptilerGeocode(
  query: string,
  autocomplete: boolean,
  capabilities: ServerCapabilities | null,
  signal: AbortSignal
): Promise<GeocodeHit[]> {
  if (
    capabilities?.maptilerGeocoding !== true ||
    typeof capabilities.maptilerPublicKey !== "string" ||
    !capabilities.maptilerPublicKey
  )
    return [];
  signal.throwIfAborted();
  const url = new URL(
    `https://api.maptiler.com/geocoding/${encodeURIComponent(query.slice(0, 200))}.json`
  );
  url.search = new URLSearchParams({
    key: capabilities.maptilerPublicKey,
    language: "cs,en",
    limit: "5",
    autocomplete: String(autocomplete)
  }).toString();
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("MapTiler hledání není dostupné.");
  return maptilerHits(await response.json());
}
