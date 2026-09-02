import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerInfoRoutes } from "./infoRoutes.js";

test("brief route rejects hostile query shapes before any provider work", async () => {
  const app = Fastify({ logger: false });
  registerInfoRoutes(app);
  await app.ready();
  try {
    const invalidCoordinate = await app.inject({
      method: "GET",
      url: "/info/brief?lng=181&lat=0"
    });
    assert.equal(invalidCoordinate.statusCode, 400);

    const invalidQid = await app.inject({
      method: "GET",
      url: "/info/brief?lng=14&lat=50&qid=DROP_TABLE"
    });
    assert.equal(invalidQid.statusCode, 400);
  } finally {
    await app.close();
  }
});
