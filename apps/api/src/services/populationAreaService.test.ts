import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";
import {
  areaPopulation,
  bboxPolygon,
  clampPopulationYear,
  isFinished,
  taskIdFrom,
  totalFrom
} from "./populationAreaService.js";

/**
 * WorldPop is asynchronous: one request creates a task, another reads it. These tests are about
 * that two-step contract being honoured and about never inventing a population figure.
 */

beforeEach(() => {
  __resetUpstreamCache();
  mock.restoreAll();
});

function stubWorldPop(handlers: { create?: () => Response; task?: () => Response }) {
  mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = String(input);
    if (url.includes("/services/stats")) {
      return handlers.create
        ? handlers.create()
        : new Response(JSON.stringify({ taskid: "7ecf25ce-71f1-5281-84da-3e29d64a60d0" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
    }
    return handlers.task
      ? handlers.task()
      : new Response(JSON.stringify({ status: "finished", data: { total_population: 10311.34 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
  });
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal
      })
  });
}

test("a bbox becomes a closed polygon", () => {
  const polygon = bboxPolygon([14, 50, 15, 51]);
  assert.equal(polygon.type, "Polygon");
  assert.deepEqual(polygon.coordinates[0]![0], [14, 50]);
  assert.deepEqual(polygon.coordinates[0]![4], [14, 50], "the ring closes");
});

test("the year is clamped to what the dataset publishes", () => {
  assert.equal(clampPopulationYear(undefined), 2020);
  assert.equal(clampPopulationYear(1990), 2000);
  assert.equal(clampPopulationYear(2030), 2020);
  assert.equal(clampPopulationYear(2015), 2015);
});

test("reads the task id and total only from the shapes that carry them", () => {
  assert.equal(
    taskIdFrom({ taskid: "7ecf25ce-71f1-5281-84da-3e29d64a60d0" }),
    "7ecf25ce-71f1-5281-84da-3e29d64a60d0"
  );
  assert.equal(taskIdFrom({ taskid: "nope" }), null);
  assert.equal(taskIdFrom(null), null);
  assert.equal(totalFrom({ data: { total_population: 42 } }), 42);
  assert.equal(totalFrom({ data: {} }), null);
  assert.equal(isFinished({ status: "finished" }), true);
  assert.equal(isFinished({ status: "created" }), false);
});

test("a finished task yields the provider's population figure", async () => {
  stubWorldPop({});
  const result = await areaPopulation([14, 50, 15, 51], { year: 2020 });
  assert.equal(result.status, "ready");
  assert.equal(result.totalPopulation, 10311.34);
  assert.equal(result.unit, "people");
  assert.equal(result.source.id, "worldpop");
});

test("a missing task id is unavailable, never zero", async () => {
  stubWorldPop({
    create: () =>
      new Response(JSON.stringify({ status: "error" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  const result = await areaPopulation([14, 50, 15, 51]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.totalPopulation, null);
});

test("an upstream failure is unavailable rather than an exception", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal
      })
  });
  const result = await areaPopulation([14, 50, 15, 51]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.totalPopulation, null);
});
