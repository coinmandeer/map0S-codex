/**
 * Events as a map layer.
 *
 * The map knows what is where but nothing about what is *on*. Ticketmaster's Discovery API
 * covers concerts, theatre and sport across Europe, gives a key immediately on registration and
 * allows 5 000 calls a day — enough for a viewport-driven layer with caching.
 *
 * Its geo filter is a geohash plus a radius rather than a bbox, which is why the encoder below
 * exists: twenty lines beat a dependency.
 */

import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { UpstreamError, fetchJson } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash encoding: alternate longitude and latitude bisections, five bits a char. */
export function geohash(lng: number, lat: number, precision = 9): string {
  let [lngMin, lngMax] = [-180, 180];
  let [latMin, latMax] = [-90, 90];
  let hash = "";
  let bits = 0;
  let bit = 0;
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bit = (bit << 1) + 1;
        lngMin = mid;
      } else {
        bit <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit <<= 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    if (++bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

interface TicketmasterEvent {
  id: string;
  name?: string;
  url?: string;
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string } };
  classifications?: Array<{ segment?: { name?: string }; genre?: { name?: string } }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  images?: Array<{ url?: string; width?: number }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      city?: { name?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
  };
}

/** `YYYY-MM-DDTHH:mm:ssZ`, which is the only format the API accepts. */
function apiDate(value: string | undefined, fallback: Date): string {
  const date = value ? new Date(value) : fallback;
  const safe = Number.isNaN(date.getTime()) ? fallback : date;
  return `${safe.toISOString().slice(0, 19)}Z`;
}

export const events: DataSource = {
  id: "events",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 400 ? "Přibliž mapu — události se hledají v okruhu do 200 km." : null,

  async load(bbox, query) {
    const key = config.layerKeys.ticketmaster;
    if (!key) throw new UpstreamError("Ticketmaster", "chybí klíč TICKETMASTER_API_KEY");

    const { lng, lat } = bboxCenter(bbox);
    const radiusKm = Math.min(200, Math.max(5, Math.round(bboxSpanKm(bbox) / 2)));
    const now = new Date();
    // The timeline writes these; without it the layer still shows the coming week.
    const start = apiDate(query.from, now);
    const end = apiDate(query.to, new Date(now.getTime() + 7 * 86_400_000));

    const params = new URLSearchParams({
      apikey: key,
      geoPoint: geohash(lng, lat, 7),
      radius: String(radiusKm),
      unit: "km",
      size: "200",
      sort: "date,asc",
      startDateTime: start,
      endDateTime: end
    });
    if (query.keyword) params.set("keyword", query.keyword);
    if (query.segment) params.set("classificationName", query.segment);

    const data = await fetchJson<{ _embedded?: { events?: TicketmasterEvent[] } }>(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
      { source: "Ticketmaster", ttlMs: 15 * 60_000 }
    );

    return (data._embedded?.events ?? []).flatMap((event): GeoFeature[] => {
      const venue = event._embedded?.venues?.[0];
      const lat2 = Number(venue?.location?.latitude);
      const lng2 = Number(venue?.location?.longitude);
      if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) return [];
      // The radius is a circle around the viewport centre, so its corners reach outside.
      if (!withinBbox(bbox, lng2, lat2)) return [];

      const startsAt =
        event.dates?.start?.dateTime ??
        (event.dates?.start?.localDate
          ? `${event.dates.start.localDate}T${event.dates.start.localTime ?? "00:00:00"}`
          : undefined);

      return [
        point(`tm:${event.id}`, event.name ?? "Událost", lng2, lat2, "events", {
          category: "event",
          startsAt,
          venue: venue?.name,
          city: venue?.city?.name,
          segment: event.classifications?.[0]?.segment?.name,
          genre: event.classifications?.[0]?.genre?.name,
          priceFrom: event.priceRanges?.[0]?.min,
          currency: event.priceRanges?.[0]?.currency,
          photo: event.images?.find((i) => (i.width ?? 0) >= 640)?.url,
          website: event.url
        })
      ];
    });
  }
};

export const eventSources: DataSource[] = [events];

export const __testing = { geohash, apiDate };
export type { Bbox };
