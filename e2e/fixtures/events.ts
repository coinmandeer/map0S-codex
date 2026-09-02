import type { Page } from "@playwright/test";
import { featureV1ToV2, type GeoFeature } from "@mapos/layer-sdk";

const DAY_MS = 86_400_000;

interface EventFixture {
  id: string;
  title: string;
  day: number;
  category: string;
  status: string;
  venue: string;
  free?: boolean;
  priceFrom?: number;
  priceTo?: number;
  currency?: string;
  position: number;
}

const EVENTS: EventFixture[] = [
  {
    id: "music-free",
    title: "Hudba pod širým nebem",
    day: 1,
    category: "Music",
    status: "scheduled",
    venue: "Městský park",
    free: true,
    position: 0.5
  },
  {
    id: "sport-paid",
    title: "Městský půlmaraton",
    day: 5,
    category: "Sports",
    status: "scheduled",
    venue: "Atletický stadion",
    free: false,
    priceFrom: 250,
    priceTo: 500,
    currency: "CZK",
    position: 0.56
  },
  {
    id: "community-unknown",
    title: "Souseds & mapa města",
    day: 120,
    category: "community",
    status: "rescheduled",
    venue: "Komunitní centrum",
    position: 0.76
  },
  {
    id: "theatre-later",
    title: "Letní divadelní festival",
    day: 340,
    category: "Arts & Theatre",
    status: "scheduled",
    venue: "Staré divadlo",
    free: false,
    position: 0.9
  }
];

function isoDaysFromNow(days: number, hour = 20): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

function selectedEvents(requestUrl: string): EventFixture[] {
  const params = new URL(requestUrl).searchParams;
  const from = params.get("from") ? Date.parse(params.get("from")!) : Number.NEGATIVE_INFINITY;
  const to = params.get("to") ? Date.parse(params.get("to")!) : Number.POSITIVE_INFINITY;
  const category = params.get("category");
  const free = params.get("free");
  const venue = params.get("venue")?.toLocaleLowerCase("cs-CZ");
  return EVENTS.filter((event) => {
    const startsAt = Date.parse(isoDaysFromNow(event.day));
    if (startsAt < from || startsAt > to) return false;
    if (category && event.category !== category) return false;
    if (free !== null && String(event.free) !== free) return false;
    if (venue && !event.venue.toLocaleLowerCase("cs-CZ").includes(venue)) return false;
    return true;
  });
}

function eventFeatures(requestUrl: string) {
  const params = new URL(requestUrl).searchParams;
  const [west, south, east, north] = params.get("bbox")!.split(",").map(Number) as [
    number,
    number,
    number,
    number
  ];
  const retrievedAt = new Date().toISOString();
  const legacyFeatures: GeoFeature[] = selectedEvents(requestUrl).map((event) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [west + (east - west) * event.position, south + (north - south) * event.position]
    },
    properties: {
      id: event.id,
      name: event.title,
      layerId: "events",
      category: event.category,
      startsAt: isoDaysFromNow(event.day),
      occurredAt: isoDaysFromNow(event.day),
      status: event.status,
      venue: event.venue,
      ...(event.free === undefined ? {} : { free: event.free }),
      ...(event.priceFrom === undefined ? {} : { priceFrom: event.priceFrom }),
      ...(event.priceTo === undefined ? {} : { priceTo: event.priceTo }),
      ...(event.currency === undefined ? {} : { currency: event.currency }),
      officialUrl: `https://events.example.invalid/${event.id}`
    }
  }));
  const features = legacyFeatures.map((feature) =>
    featureV1ToV2(feature, {
      providerId: "event-e2e-fixture",
      sourceId: feature.properties.id,
      attribution: "Event E2E fixture",
      retrievedAt,
      originalUrl: String(feature.properties.officialUrl),
      rights: "open",
      kind: "event"
    })
  );
  return {
    data: { type: "FeatureCollection", features },
    meta: {
      limit: 100,
      returned: features.length,
      truncated: false,
      nextCursor: null,
      cache: "miss",
      sources: [{ providerId: "event-e2e-fixture", state: "ready" }]
    },
    notices: []
  };
}

function eventDetail(id: string) {
  const fixture = EVENTS.find((event) => event.id === id) ?? EVENTS[0]!;
  const startsAt = isoDaysFromNow(fixture.day);
  return {
    schema: "mapos.event",
    schemaVersion: "2.0.0",
    id: fixture.id,
    revision: 1,
    title: fixture.title,
    description: "Ověřený detail události z testovacího zdroje.",
    categories: [fixture.category],
    status: fixture.status,
    schedule: { startsAt, timezone: "Europe/Prague" },
    venue: {
      name: fixture.venue,
      location: { type: "Point", coordinates: [14.4, 50.1] }
    },
    price:
      fixture.free === undefined
        ? null
        : {
            free: fixture.free,
            min: fixture.priceFrom ?? (fixture.free ? 0 : null),
            max: fixture.priceTo ?? (fixture.free ? 0 : null),
            currency: fixture.currency
          },
    officialUrl: `https://events.example.invalid/${fixture.id}`,
    sources: [
      {
        providerId: "event-e2e-fixture",
        sourceId: fixture.id,
        retrievedAt: new Date().toISOString(),
        attribution: "Event E2E fixture",
        confidence: 1
      }
    ]
  };
}

export async function stubEvents(page: Page): Promise<void> {
  await page.route("**/config", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: { ...body, capabilities: { ...body.capabilities, ticketmaster: true } }
    });
  });
  await page.route("**/v2/layers/events/features**", (route) =>
    route.fulfill({ json: eventFeatures(route.request().url()) })
  );
  await page.route(/\/v2\/events\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return route.fulfill({ json: { event: eventDetail(id) } });
  });
}
