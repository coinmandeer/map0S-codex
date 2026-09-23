import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerWeatherGridRoutes } from "./weatherGridRoutes.js";
import { resetWeatherGridCache } from "../services/weatherGridService.js";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";

test("weather route validates model selection before transport and returns the requested model", async () => {
  const app = Fastify();
  registerWeatherGridRoutes(app);
  const models: string[] = [];
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (url) => {
      models.push(url.searchParams.get("models")!);
      const hour = new Date().toISOString().slice(0, 13) + ":00";
      const point = { hourly: { time: [hour], temperature_2m: [18] } };
      return new Response(JSON.stringify([point, point, point, point]), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  try {
    const path = "/weather/grid?bbox=14,49,15,50&variable=temperature&cols=2&rows=2";
    assert.equal((await app.inject(path + "&model=unknown")).statusCode, 400);
    assert.equal(models.length, 0);
    const result = await app.inject(path + "&model=chmi_aladin_seamless");
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().model, "chmi_aladin_seamless");
    assert.equal(result.json().sampleCount, 4);
    assert.deepEqual(models, ["chmi_aladin_seamless"]);
  } finally {
    await app.close();
    resetWeatherGridCache();
    __resetUpstreamCache();
  }
});
