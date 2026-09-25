import { mapyGeocode } from "../mapyService.js";
import { fetchJson } from "../../utils/upstream.js";
/** Only called after an explicit user question, never from typing or a map move. */
export async function resolveChatLocation(query: string, signal?: AbortSignal) {
  try {
    const items = await mapyGeocode(query, "cs", 5, signal);
    if (items.length)
      return items.map((p) => ({
        name: [p.name, p.location].filter(Boolean).join(", "),
        longitude: p.position.lon,
        latitude: p.position.lat
      }));
  } catch {
    signal?.throwIfAborted();
    /* Shared budget/config failure falls back to the explicit-search provider. */
  }
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "5" });
  const items = await fetchJson<{ display_name: string; lon: string; lat: string }[]>(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      providerId: "nominatim",
      signal,
      ttlMs: 86400000,
      minIntervalMs: 1100,
      timeoutMs: 8000,
      maxResponseBytes: 512 * 1024
    }
  );
  return items
    .filter(
      (p) =>
        Number.isFinite(Number(p.lon)) &&
        Math.abs(Number(p.lon)) <= 180 &&
        Number.isFinite(Number(p.lat)) &&
        Math.abs(Number(p.lat)) <= 90
    )
    .map((p) => ({ name: p.display_name, longitude: Number(p.lon), latitude: Number(p.lat) }));
}
