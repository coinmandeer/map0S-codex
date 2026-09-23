import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { point, withinBbox, type DataSource, type DataSourceResult } from "./types.js";

export const EONET_CATEGORIES = [
  "wildfires",
  "severeStorms",
  "volcanoes",
  "floods",
  "landslides",
  "seaLakeIce",
  "snow",
  "drought",
  "dustHaze",
  "earthquakes",
  "manmade",
  "tempExtremes",
  "waterColor"
];
interface Event {
  id?: string;
  title?: string;
  closed?: string | null;
  categories?: Array<{ id: string; title: string }>;
  sources?: Array<{ id: string; url: string }>;
  geometry?: Array<{ date: string; type: string; coordinates: unknown }>;
}
export function eonetQuery(bbox: Bbox, filters: Record<string, string | undefined>) {
  const [w, s, e, n] = bbox;
  if (
    ![w, s, e, n].every(Number.isFinite) ||
    w < -180 ||
    e > 180 ||
    s < -90 ||
    n > 90 ||
    w >= e ||
    s >= n
  )
    throw new Error("Invalid EONET bounds");
  const days = Number(filters.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid EONET period");
  const categories = [...new Set((filters.category ?? "").split(",").filter(Boolean))].sort();
  if (categories.some((c) => !EONET_CATEGORIES.includes(c)))
    throw new Error("Invalid EONET category");
  const query = new URLSearchParams({
    bbox: [w, n, e, s].join(","),
    days: String(days),
    status: "all",
    limit: "200"
  });
  if (categories.length) query.set("category", categories.join(","));
  return query;
}
export function mapEonetEvents(events: Event[], bbox: Bbox): DataSourceResult {
  let unsupported = 0;
  const features: GeoFeature[] = [];
  for (const event of events.slice(0, 200)) {
    const latest = [...(event.geometry ?? [])].sort(
      (a, b) => Date.parse(b.date) - Date.parse(a.date)
    )[0];
    if (
      !event.id ||
      !latest ||
      !Number.isFinite(Date.parse(latest.date)) ||
      latest.type !== "Point" ||
      !Array.isArray(latest.coordinates)
    ) {
      unsupported++;
      continue;
    }
    const [lng, lat] = latest.coordinates;
    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng) > 180 ||
      Math.abs(lat) > 90
    ) {
      unsupported++;
      continue;
    }
    // A historic position inside the viewport does not make the newest position local.
    if (!withinBbox(bbox, lng, lat)) continue;
    const website = event.sources?.find((s) => /^https:\/\//.test(s.url))?.url;
    features.push(
      point(`eonet:${event.id}`, event.title ?? "Přírodní událost", lng, lat, "eonet", {
        category: event.categories?.[0]?.id ?? "natural-event",
        eventTypes: event.categories?.map((c) => c.title).join(", "),
        occurredAt: latest.date,
        eventStatus:
          event.closed === null
            ? "Zdroj eviduje jako probíhající"
            : event.closed
              ? "Zdroj eviduje jako ukončené"
              : "Stav neznámý",
        closedAt: event.closed ?? undefined,
        website:
          website ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}`,
        attribution: "NASA EONET · " + (event.sources?.map((s) => s.id).join(", ") ?? ""),
        locationMeaning: "Poslední publikovaná bodová poloha; nejde o hranici zasaženého území"
      })
    );
  }
  const partial = unsupported > 0 || events.length >= 200;
  return {
    features,
    status: partial ? "partial" : "complete",
    notice: partial
      ? `Částečný přehled: ${unsupported} záznamů bez podporované bodové polohy${events.length >= 200 ? "; dosažen limit 200 událostí, přibližte mapu nebo zkraťte období" : ""}.`
      : undefined
  };
}
export function createEonetSource(fetcher: typeof fetchJson = fetchJson): DataSource {
  return {
    id: "eonet",
    async load(bbox, filters, signal) {
      const query = eonetQuery(bbox, filters);
      const data = await fetcher<{ events?: Event[] }>(
        `https://eonet.gsfc.nasa.gov/api/v3/events?${query}`,
        {
          signal,
          providerId: "nasa-eonet",
          ttlMs: 15 * 60_000,
          timeoutMs: 15_000,
          maxResponseBytes: 2 * 1024 * 1024,
          retries: 0
        }
      );
      signal?.throwIfAborted();
      if (!Array.isArray(data.events)) throw new Error("Invalid EONET response");
      return mapEonetEvents(data.events, bbox);
    }
  };
}
export const eonet = createEonetSource();
