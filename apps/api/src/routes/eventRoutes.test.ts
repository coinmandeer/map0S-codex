import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { registerEventRoutes } from "./eventRoutes.js";
import { buildMemoryEventFixtures } from "../services/events/eventFixtures.js";
import { MemoryEventRepository } from "../services/events/eventMemoryRepository.js";
import { EventService } from "../services/events/eventService.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function app() {
  const now = new Date("2026-09-01T08:00:00.000Z");
  const instance = Fastify({ logger: false });
  apps.push(instance);
  const repository = new MemoryEventRepository(buildMemoryEventFixtures(now));
  registerEventRoutes(instance, {
    service: new EventService(repository, [], () => now),
    refreshProvider: false
  });
  return instance;
}

test("shared event registrar returns canonical detail, filters and v2 map features", async () => {
  const server = app();
  const list = await server.inject({
    method: "GET",
    url: "/v2/events?from=2026-09-01T00%3A00%3A00Z&to=2027-09-01T00%3A00%3A00Z&status=rescheduled&free=true"
  });
  assert.equal(list.statusCode, 200);
  const listed = list.json();
  assert.equal(listed.events.length, 1);
  assert.equal(listed.events[0].status, "rescheduled");

  const id = listed.events[0].id as string;
  const detail = await server.inject({ method: "GET", url: `/v2/events/${id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().event.sources[0].providerId, "mapos-offline-fixture");

  const features = await server.inject({
    method: "GET",
    url: "/v2/layers/events/features?bbox=-1,39,0,40&from=2026-09-01T00%3A00%3A00Z&to=2027-09-01T00%3A00%3A00Z"
  });
  assert.equal(features.statusCode, 200);
  assert.equal(features.json().data.features[0].properties.kind, "event");
});

test("shared event routes expose closed source gates and reject hostile query shapes", async () => {
  const server = app();
  const sources = await server.inject({ method: "GET", url: "/v2/events/sources" });
  assert.equal(sources.statusCode, 200);
  assert.equal(
    sources.json().sources.find((source: { id: string }) => source.id === "facebook").enabled,
    false
  );
  assert.equal(
    sources.json().sources.find((source: { id: string }) => source.id === "ticketmaster").enabled,
    false
  );

  const invalidBbox = await server.inject({
    method: "GET",
    url: "/v2/layers/events/features?bbox=-200,0,10,20"
  });
  assert.equal(invalidBbox.statusCode, 400);
  const unknown = await server.inject({ method: "GET", url: "/v2/events?unexpected=1" });
  assert.equal(unknown.statusCode, 400);
  const invalidStatus = await server.inject({ method: "GET", url: "/v2/events?status=secret" });
  assert.equal(invalidStatus.statusCode, 400);
});
