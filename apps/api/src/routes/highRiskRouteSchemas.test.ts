import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerMapyRoutes } from "./mapyRoutes.js";
import { registerWeatherGridRoutes } from "./weatherGridRoutes.js";

test("map and weather routes reject unbounded or unexpected public input before providers", async (t) => {
  const app = Fastify();
  registerMapyRoutes(app);
  registerWeatherGridRoutes(app);
  await app.ready();
  t.after(() => app.close());

  const cases = [
    "/mapy/attribution?leak=1",
    `/mapy/geocode?q=${"x".repeat(201)}`,
    "/mapy/tiles/basic/99/0/0.png",
    "/mapy/suggest?q=Praha&bbox=not-a-bbox",
    "/weather/variables?detail=all",
    "/weather/grid?bbox=13,49,14,50&cols=10000",
    "/weather/grid?bbox=13,49,14,50&variable=rain_of_frogs"
  ];
  for (const url of cases) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
  }
});
