/** Ticketmaster is an explicitly configured adapter, never a scraping path. */
import {
  MAPOS_V2_SCHEMA_VERSION,
  type Bbox,
  type EventDocumentV2,
  type EventStatusV2,
  type GeoFeature
} from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { UpstreamError, fetchJson } from "../../utils/upstream.js";
import type { EventAdapter, EventAdapterQuery } from "../events/eventService.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

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

export interface TicketmasterEvent {
  id: string;
  name?: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    end?: { dateTime?: string; localDate?: string; localTime?: string };
    timezone?: string;
    status?: { code?: string };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
    type?: { name?: string };
  }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string; type?: string }>;
  images?: Array<{ url?: string; width?: number; fallback?: boolean }>;
  promoter?: { id?: string; name?: string };
  promoters?: Array<{ id?: string; name?: string }>;
  accessibility?: { info?: string; ticketLimit?: number };
  ageRestrictions?: { legalAgeEnforced?: boolean };
  _embedded?: {
    venues?: Array<{
      id?: string;
      name?: string;
      city?: { name?: string };
      country?: { name?: string };
      address?: { line1?: string; line2?: string };
      postalCode?: string;
      timezone?: string;
      location?: { latitude?: string; longitude?: string };
    }>;
    attractions?: Array<{
      name?: string;
      url?: string;
      classifications?: Array<{ segment?: { name?: string } }>;
    }>;
  };
}

/** `YYYY-MM-DDTHH:mm:ssZ`, which is the only format the provider accepts. */
function apiDate(value: string | undefined, fallback: Date): string {
  const date = value ? new Date(value) : fallback;
  const safe = Number.isNaN(date.getTime()) ? fallback : date;
  return `${safe.toISOString().slice(0, 19)}Z`;
}

function localDateTime(
  part: { dateTime?: string; localDate?: string; localTime?: string } | undefined
): string | undefined {
  if (part?.dateTime) return part.dateTime;
  if (!part?.localDate) return undefined;
  return `${part.localDate}T${part.localTime ?? "00:00:00"}`;
}

function status(code: string | undefined): EventStatusV2 {
  switch (code?.toLocaleLowerCase("en")) {
    case "onsale":
    case "offsale":
      return "scheduled";
    case "cancelled":
      return "cancelled";
    case "postponed":
      return "postponed";
    case "rescheduled":
      return "rescheduled";
    default:
      return "unknown";
  }
}

function address(event: TicketmasterEvent): string | null {
  const venue = event._embedded?.venues?.[0];
  return (
    [
      venue?.address?.line1,
      venue?.address?.line2,
      venue?.postalCode,
      venue?.city?.name,
      venue?.country?.name
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

function categories(event: TicketmasterEvent): string[] {
  const classification = event.classifications?.[0];
  const values = [
    classification?.segment?.name,
    classification?.genre?.name,
    classification?.subGenre?.name,
    classification?.type?.name
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values.length ? values : ["event"])];
}

function mapTicketmasterEvent(
  event: TicketmasterEvent,
  retrievedAt: string
): EventDocumentV2 | null {
  const venue = event._embedded?.venues?.[0];
  const lat = Number(venue?.location?.latitude);
  const lng = Number(venue?.location?.longitude);
  const startsAt = localDateTime(event.dates?.start);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !startsAt ||
    Number.isNaN(Date.parse(startsAt))
  ) {
    return null;
  }
  const endsAt = localDateTime(event.dates?.end);
  const price = event.priceRanges?.[0];
  const promoter = event.promoter ?? event.promoters?.[0];
  const providerSourceId = `ticketmaster:${event.id}`;
  const note = [event.info, event.pleaseNote].filter(Boolean).join("\n\n") || null;
  const eventStatus = status(event.dates?.status?.code);
  return {
    schema: "mapos.event",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: providerSourceId,
    revision: 1,
    title: event.name?.trim() || "Událost",
    description: event.info ?? null,
    categories: categories(event),
    status: eventStatus,
    schedule: {
      startsAt,
      endsAt: endsAt && !Number.isNaN(Date.parse(endsAt)) ? endsAt : null,
      timezone: event.dates?.timezone ?? venue?.timezone ?? "UTC",
      allDay: Boolean(event.dates?.start?.localDate && !event.dates.start.localTime),
      recurrence: null,
      occurrenceId: event.id
    },
    venue: {
      name: venue?.name?.trim() || venue?.city?.name?.trim() || "Místo události",
      address: address(event),
      location: { type: "Point", coordinates: [lng, lat] },
      externalId: venue?.id ?? null
    },
    performers: event._embedded?.attractions?.map((attraction) => ({
      name: attraction.name?.trim() || "Účinkující",
      role: attraction.classifications?.[0]?.segment?.name ?? null,
      ...(attraction.url ? { url: attraction.url } : {})
    })),
    organizer: promoter?.name ? { name: promoter.name } : null,
    price: price
      ? {
          currency: price.currency?.toUpperCase(),
          min: price.min ?? null,
          max: price.max ?? null,
          free: price.min === 0 && price.max === 0,
          note: price.type ?? null
        }
      : null,
    ticketUrl: event.url ?? null,
    officialUrl: event.url ?? null,
    ticketOffers: event.url
      ? [
          {
            sourceId: providerSourceId,
            label: "Ticketmaster",
            url: event.url,
            currency: price?.currency?.toUpperCase() ?? null,
            min: price?.min ?? null,
            max: price?.max ?? null,
            availability: eventStatus === "cancelled" ? "cancelled" : "unknown"
          }
        ]
      : [],
    ageRestriction: event.ageRestrictions?.legalAgeEnforced ? "legal-age-enforced" : null,
    accessibility: event.accessibility?.info ? [event.accessibility.info] : [],
    notes: note,
    media: event.images
      ?.filter((image) => image.url && !image.fallback)
      .sort((left, right) => (right.width ?? 0) - (left.width ?? 0))
      .slice(0, 8)
      .map((image) => ({
        url: image.url!,
        type: "image",
        credit: "Ticketmaster",
        license: "Ticketmaster Developer Agreement",
        sourceId: providerSourceId
      })),
    sources: [
      {
        providerId: "ticketmaster",
        sourceId: event.id,
        ...(event.url ? { url: event.url } : {}),
        retrievedAt,
        attribution: "Ticketmaster Discovery",
        license: "Ticketmaster Developer Agreement",
        confidence: 0.9
      }
    ],
    createdAt: retrievedAt,
    updatedAt: retrievedAt
  };
}

type TicketmasterResponse = { _embedded?: { events?: TicketmasterEvent[] } };

export interface TicketmasterAdapterOptions {
  apiKey: string;
  fetcher?: (url: string) => Promise<TicketmasterResponse>;
  clock?: () => Date;
}

export function createTicketmasterEventAdapter(options: TicketmasterAdapterOptions): EventAdapter {
  const clock = options.clock ?? (() => new Date());
  const fetcher =
    options.fetcher ??
    ((url: string) =>
      fetchJson<TicketmasterResponse>(url, {
        providerId: "ticketmaster",
        ttlMs: 15 * 60_000,
        retries: 1
      }));
  return {
    id: "ticketmaster",
    async load(query: EventAdapterQuery) {
      if (!options.apiKey) {
        throw new UpstreamError("Ticketmaster", "chybí klíč TICKETMASTER_API_KEY");
      }
      if (bboxSpanKm(query.bbox) > 400) {
        throw new UpstreamError(
          "Ticketmaster",
          "Přibliž mapu — události se hledají v okruhu do 200 km."
        );
      }
      const { lng, lat } = bboxCenter(query.bbox);
      const radiusKm = Math.min(200, Math.max(5, Math.round(bboxSpanKm(query.bbox) / 2)));
      const params = new URLSearchParams({
        apikey: options.apiKey,
        geoPoint: geohash(lng, lat, 7),
        radius: String(radiusKm),
        unit: "km",
        size: "100",
        sort: "date,asc",
        startDateTime: apiDate(query.from, clock()),
        endDateTime: apiDate(query.to, new Date(clock().getTime() + 7 * 86_400_000))
      });
      if (query.keyword) params.set("keyword", query.keyword);
      if (query.category) params.set("classificationName", query.category);
      const response = await fetcher(
        `https://app.ticketmaster.com/discovery/v2/events.json?${params}`
      );
      const retrievedAt = clock().toISOString();
      return (response._embedded?.events ?? [])
        .map((event) => mapTicketmasterEvent(event, retrievedAt))
        .filter((event): event is EventDocumentV2 => Boolean(event))
        .filter((event) => {
          const [eventLng, eventLat] = event.venue.location.coordinates;
          return withinBbox(query.bbox, eventLng, eventLat);
        });
    }
  };
}

export function configuredTicketmasterEventAdapter(): EventAdapter | null {
  const apiKey = config.layerKeys.ticketmaster;
  return apiKey ? createTicketmasterEventAdapter({ apiKey }) : null;
}

/** Legacy v1 facade retained for old layer URLs while v2 uses EventService. */
export const events: DataSource = {
  id: "events",
  v2: {
    providerId: "ticketmaster",
    attribution: "Ticketmaster Discovery",
    license: "Ticketmaster Developer Agreement",
    rights: "restricted-display",
    confidence: 0.9,
    kind: "event"
  },
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 400 ? "Přibliž mapu — události se hledají v okruhu do 200 km." : null,
  async load(bbox, query) {
    const key = config.layerKeys.ticketmaster;
    if (!key) throw new UpstreamError("Ticketmaster", "chybí klíč TICKETMASTER_API_KEY");
    const now = new Date();
    const documents = await createTicketmasterEventAdapter({ apiKey: key }).load({
      bbox,
      from: query.from ?? now.toISOString(),
      to: query.to ?? new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      keyword: query.keyword,
      category: query.segment
    });
    return documents.map((event): GeoFeature => {
      const [lng, lat] = event.venue.location.coordinates;
      return point(event.id, event.title, lng, lat, "events", {
        category: "event",
        eventCategory: event.categories[0],
        startsAt: event.schedule.startsAt,
        endsAt: event.schedule.endsAt,
        timezone: event.schedule.timezone,
        status: event.status,
        venue: event.venue.name,
        city: event.venue.address,
        performers: event.performers?.map((performer) => performer.name),
        organizer: event.organizer?.name,
        priceFrom: event.price?.min,
        priceTo: event.price?.max,
        free: event.price?.free,
        currency: event.price?.currency,
        photo: event.media?.[0]?.url,
        website: event.officialUrl,
        ticketUrl: event.ticketUrl,
        sourceIds: event.sources.map((source) => `${source.providerId}:${source.sourceId}`)
      });
    });
  }
};

export const eventSources: DataSource[] = [events];

export const __testing = { geohash, apiDate, status, mapTicketmasterEvent };
export type { Bbox };
