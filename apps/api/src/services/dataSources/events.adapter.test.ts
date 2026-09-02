import assert from "node:assert/strict";
import test from "node:test";
import { createTicketmasterEventAdapter } from "./events.js";

test("Ticketmaster adapter maps status/end/performers/organizer/tickets and never needs live I/O", async () => {
  let requestUrl = "";
  const adapter = createTicketmasterEventAdapter({
    apiKey: "test-key",
    clock: () => new Date("2026-09-01T08:00:00.000Z"),
    fetcher: async (url) => {
      requestUrl = url;
      return {
        _embedded: {
          events: [
            {
              id: "tm-1",
              name: "The Band",
              url: "https://tickets.example.invalid/tm-1",
              info: "Official event information",
              dates: {
                start: { dateTime: "2026-10-01T18:00:00Z" },
                end: { dateTime: "2026-10-01T21:00:00Z" },
                timezone: "Europe/Prague",
                status: { code: "rescheduled" }
              },
              classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
              priceRanges: [{ min: 25, max: 50, currency: "EUR" }],
              promoter: { id: "p-1", name: "Official promoter" },
              accessibility: { info: "Wheelchair seats available" },
              ageRestrictions: { legalAgeEnforced: true },
              images: [{ url: "https://images.example.invalid/tm-1.jpg", width: 1024 }],
              _embedded: {
                venues: [
                  {
                    id: "venue-1",
                    name: "Arena",
                    city: { name: "Praha" },
                    country: { name: "Česko" },
                    timezone: "Europe/Prague",
                    location: { latitude: "50.08", longitude: "14.42" }
                  }
                ],
                attractions: [{ name: "The Band", url: "https://band.example.invalid" }]
              }
            }
          ]
        }
      };
    }
  });

  const [event] = await adapter.load({
    bbox: [14.3, 50, 14.6, 50.2],
    from: "2026-09-01T00:00:00Z",
    to: "2026-12-01T00:00:00Z",
    category: "Music"
  });
  assert.ok(requestUrl.startsWith("https://app.ticketmaster.com/discovery/v2/events.json?"));
  assert.match(requestUrl, /size=100/);
  assert.equal(event?.status, "rescheduled");
  assert.equal(event?.schedule.endsAt, "2026-10-01T21:00:00Z");
  assert.equal(event?.performers?.[0]?.name, "The Band");
  assert.equal(event?.organizer?.name, "Official promoter");
  assert.equal(event?.ticketOffers?.[0]?.min, 25);
  assert.deepEqual(event?.categories, ["Music", "Rock"]);
  assert.equal(event?.sources[0]?.sourceId, "tm-1");
  assert.equal(event?.ageRestriction, "legal-age-enforced");
});
