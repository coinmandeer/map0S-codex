import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerOfflineFixtureRoutes } from "./offlineFixtureRoutes.js";

async function fixtureApp() {
  const app = Fastify({ logger: false });
  registerOfflineFixtureRoutes(app);
  await app.ready();
  return app;
}

test("offline weather routes return deterministic synthetic data", async (t) => {
  const app = await fixtureApp();
  t.after(() => app.close());

  const first = await app.inject({
    method: "GET",
    url: "/weather/grid?bbox=13,49,14,50&variable=wind&cols=3&rows=2"
  });
  const second = await app.inject({
    method: "GET",
    url: "/weather/grid?bbox=13,49,14,50&variable=wind&cols=3&rows=2"
  });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), second.json());
  assert.equal(first.json().sampleCount, 6);
  assert.equal(first.json().model, "best_match");
  const selectedModel = await app.inject(
    "/weather/grid?bbox=13,49,14,50&model=chmi_aladin_seamless"
  );
  assert.equal(selectedModel.statusCode, 200);
  assert.equal(selectedModel.json().model, "chmi_aladin_seamless");
  assert.equal((await app.inject("/weather/grid?bbox=13,49,14,50&model=unknown")).statusCode, 400);
  assert.equal(first.json().generatedAt, "2026-09-01T12:00:00.000Z");

  const forecast = await app.inject({
    method: "GET",
    url: "/info/weather?lng=14&lat=50"
  });
  assert.equal(forecast.statusCode, 200);
  assert.equal(forecast.json().daily.length, 7);
  // The offline fixture carries deterministic climate normals so the graph has something to draw
  // without a network; it is synthetic and labelled as such.
  assert.equal(forecast.json().climate.status, "ready");
  assert.equal(forecast.json().climate.period, "1991-2020");
  assert.equal(forecast.json().climate.normals.length, 12);
  assert.equal(forecast.json().climate.source.id, "offline-fixture");
});

test("offline content routes never advertise a live embed", async (t) => {
  const app = await fixtureApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/info/embeddable?url=https%3A%2F%2Fwww.windy.com%2Fembed"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().verdict, "blocked");
  assert.match(response.json().reason, /offline fixture/);
});

test("offline Mapy search fixture keeps the provider response schema", async (t) => {
  const app = await fixtureApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/mapy/suggest?q=Plze%C5%88" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().results[0], {
    name: "Plzeň",
    label: "Plzeň — offline fixture",
    location: "Česko",
    position: { lon: 13.3775, lat: 49.7475 },
    type: "regional"
  });
});

test("offline guide fixture keeps the production route and guide schema", async (t) => {
  const app = await fixtureApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/discover/guide?bbox=13.2,49.6,13.5,49.9&lang=cs"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().sourceId, "offline-fixture");
  assert.equal(response.json().sections[0].items[0].sourceRef, "fixture:lookout");
});
