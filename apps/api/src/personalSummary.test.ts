import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMemoryApp } from "./memory-server.js";

test("personal summary is owner-scoped, compact and never cacheable", async () => {
  const app = await buildMemoryApp({ offlineFixture: true, rateLimitMultiplier: 100 });
  const unauthorized = await app.inject({ method: "GET", url: "/me/personal-summary" });
  assert.equal(unauthorized.statusCode, 401);

  const guest = await app.inject({
    method: "POST",
    url: "/auth/guest",
    headers: {
      host: "mapos.test",
      origin: "http://mapos.test",
      "content-type": "application/json"
    },
    payload: {}
  });
  assert.equal(guest.statusCode, 200, guest.body);
  const setCookie = guest.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
  assert.ok(cookie);

  const response = await app.inject({
    method: "GET",
    url: "/me/personal-summary",
    headers: { cookie }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["cache-control"] ?? "", /private/);
  assert.match(response.headers["cache-control"] ?? "", /no-store/);
  assert.deepEqual(response.json(), { plans: 0, places: 0, layers: 0 });
  assert.ok(Buffer.byteLength(response.body) < 100);
  await app.close();
});
