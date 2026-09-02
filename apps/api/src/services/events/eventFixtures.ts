import { MAPOS_V2_SCHEMA_VERSION, type EventDocumentV2 } from "@mapos/layer-sdk";

function iso(date: Date, days: number, hour: number): string {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

/** Clearly labelled synthetic rows for network-free memory/offline verification only. */
export function buildMemoryEventFixtures(now = new Date()): EventDocumentV2[] {
  const definitions = [
    {
      id: "offline-concert",
      title: "Offline fixture koncert",
      days: 7,
      coordinates: [14.4378, 50.0755] as [number, number],
      venue: "Fixture Hall",
      category: "music",
      status: "scheduled" as const,
      free: false
    },
    {
      id: "offline-community",
      title: "Offline fixture komunitní den",
      days: 45,
      coordinates: [-0.3763, 39.4699] as [number, number],
      venue: "Fixture Plaza",
      category: "community",
      status: "rescheduled" as const,
      free: true
    },
    {
      id: "offline-sport",
      title: "Offline fixture sport",
      days: 200,
      coordinates: [-3.7038, 40.4168] as [number, number],
      venue: "Fixture Arena",
      category: "sport",
      status: "cancelled" as const,
      free: false
    }
  ];
  return definitions.map((definition) => {
    const startsAt = iso(now, definition.days, 18);
    const retrievedAt = now.toISOString();
    return {
      schema: "mapos.event",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      id: `event:fixture:${definition.id}`,
      revision: 1,
      title: definition.title,
      description: "Syntetická událost pro offline kontraktní režim; nejde o reálnou nabídku.",
      categories: [definition.category],
      status: definition.status,
      schedule: {
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 2 * 60 * 60 * 1_000).toISOString(),
        timezone: "UTC",
        occurrenceId: definition.id
      },
      venue: {
        name: definition.venue,
        address: "Synthetic fixture",
        location: { type: "Point", coordinates: definition.coordinates },
        externalId: `fixture-venue:${definition.id}`
      },
      performers: [{ name: "Fixture performer", role: "test-data" }],
      organizer: { name: "MapOS offline fixture" },
      price: {
        currency: "EUR",
        min: definition.free ? 0 : 10,
        max: definition.free ? 0 : 25,
        free: definition.free,
        note: "synthetic"
      },
      sources: [
        {
          providerId: "mapos-offline-fixture",
          sourceId: definition.id,
          retrievedAt,
          attribution: "MapOS synthetic offline fixture",
          license: null,
          confidence: 1
        }
      ],
      dedupe: {
        fingerprint: `${definition.title}|${definition.venue}|${startsAt.slice(0, 16)}`,
        mergedEventIds: [`mapos-offline-fixture:${definition.id}`]
      },
      createdAt: retrievedAt,
      updatedAt: retrievedAt
    };
  });
}
