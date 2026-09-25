import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { resolveCorsOrigins, resolveTrustedProxies } from "../config.js";
import {
  classifyRequestBudget,
  exactCorsOriginPolicy,
  FixedWindowRateLimiter,
  rateLimitAllRequests,
  rateLimitByIp,
  requireAllowedMutationOrigin
} from "./publicApiHardening.js";

test("credentialed CORS uses exact normalized origins and fails closed in production", () => {
  assert.deepEqual(resolveCorsOrigins(undefined, "production"), []);
  assert.deepEqual(resolveCorsOrigins(undefined, "development"), [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173"
  ]);
  assert.deepEqual(
    resolveCorsOrigins(
      "https://mapos.example, https://mapos.example/,http://localhost:5173",
      "production"
    ),
    ["https://mapos.example", "http://localhost:5173"]
  );
  assert.throws(() => resolveCorsOrigins("*", "production"), /wildcard/);
  assert.throws(() => resolveCorsOrigins("https://mapos.example/api", "production"), /bare HTTP/);

  const policy = exactCorsOriginPolicy(["https://mapos.example"]);
  policy("https://mapos.example", (error, origin) => {
    assert.equal(error, null);
    assert.equal(origin, "https://mapos.example");
  });
  policy("https://attacker.example", (error, origin) => {
    assert.equal(error, null);
    assert.equal(origin, false);
  });
});

test("proxy trust is address based and ignores spoofed forwarding headers from untrusted peers", async () => {
  assert.equal(resolveTrustedProxies(undefined, "development"), false);
  assert.equal(resolveTrustedProxies(undefined, "production"), "loopback,linklocal,uniquelocal");
  assert.throws(() => resolveTrustedProxies("2", "production"), /addresses\/CIDRs/);
  assert.throws(() => resolveTrustedProxies("true", "production"), /addresses\/CIDRs/);

  const app = Fastify({
    logger: false,
    trustProxy: resolveTrustedProxies(undefined, "production")
  });
  app.addHook("onRequest", requireAllowedMutationOrigin([]));
  app.get("/ip", async (request) => ({ ip: request.ip }));
  app.post("/mutation", async () => ({ ok: true }));

  const proxied = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: "172.18.0.2",
    // Public edge -> Docker host/gateway -> web nginx -> API.
    headers: { "x-forwarded-for": "198.51.100.7, 172.18.0.1" }
  });
  assert.equal(proxied.json().ip, "198.51.100.7");

  const direct = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: "203.0.113.9",
    headers: { "x-forwarded-for": "198.51.100.99" }
  });
  assert.equal(direct.json().ip, "203.0.113.9");

  const sameOriginBehindProxy = await app.inject({
    method: "POST",
    url: "/mutation",
    remoteAddress: "172.18.0.2",
    headers: {
      host: "mapos.example",
      origin: "https://mapos.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(sameOriginBehindProxy.statusCode, 200);

  const siblingOriginBehindProxy = await app.inject({
    method: "POST",
    url: "/mutation",
    remoteAddress: "172.18.0.2",
    headers: {
      host: "mapos.example",
      origin: "https://evil.mapos.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(siblingOriginBehindProxy.statusCode, 403);
  await app.close();
});

test("fixed-window limiter resets on time and bounds attacker-controlled keys", () => {
  const limiter = new FixedWindowRateLimiter(2);
  assert.equal(limiter.consume("a", 2, 1_000, 1_000).allowed, true);
  assert.equal(limiter.consume("a", 2, 1_000, 1_100).allowed, true);
  const denied = limiter.consume("a", 2, 1_000, 1_200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.consume("a", 2, 1_000, 2_000).allowed, true);

  limiter.consume("b", 1, 10_000, 2_000);
  limiter.consume("c", 1, 10_000, 2_000);
  assert.equal(limiter.size, 2);
});

test("IP pre-handler returns finite rate metadata and Retry-After", async () => {
  const app = Fastify({ logger: false });
  const limiter = new FixedWindowRateLimiter();
  let handlerRuns = 0;
  app.get(
    "/limited",
    {
      preHandler: rateLimitByIp(limiter, {
        bucket: "test",
        limit: 2,
        windowMs: 60_000
      })
    },
    async () => {
      handlerRuns += 1;
      return { ok: true };
    }
  );

  assert.equal((await app.inject({ method: "GET", url: "/limited" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/limited" })).statusCode, 200);
  const denied = await app.inject({ method: "GET", url: "/limited" });
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers["ratelimit-limit"], "2");
  assert.equal(denied.headers["ratelimit-remaining"], "0");
  assert.ok(Number(denied.headers["retry-after"]) >= 1);
  assert.equal(handlerRuns, 2);
  await app.close();
});

test("global budgets classify sensitive operations without including request values", async () => {
  const classify = (method: string, url: string) =>
    classifyRequestBudget({ method, routeOptions: { url } } as never);
  assert.equal(classify("POST", "/auth/login").bucket, "auth");
  assert.equal(classify("POST", "/v2/layer-imports/preview").bucket, "import");
  assert.equal(classify("POST", "/v2/commerce/webhook").bucket, "commerce");
  assert.equal(classify("GET", "/places").bucket, "read");
  assert.equal(classify("POST", "/v2/world/position").bucket, "world");
  assert.equal(classify("POST", "/v2/world/threads/get").bucket, "world");

  const app = Fastify({ logger: false });
  app.addHook("preHandler", rateLimitAllRequests(new FixedWindowRateLimiter()));
  app.post("/auth/login", async () => ({ ok: true }));
  for (let count = 0; count < 30; count += 1) {
    assert.equal((await app.inject({ method: "POST", url: "/auth/login" })).statusCode, 200);
  }
  assert.equal((await app.inject({ method: "POST", url: "/auth/login" })).statusCode, 429);
  await app.close();
});

test("an explicit bounded multiplier scales only the isolated caller's budget", async () => {
  assert.throws(
    () => rateLimitAllRequests(new FixedWindowRateLimiter(), { limitMultiplier: 101 }),
    /between 1 and 100/
  );

  const app = Fastify({ logger: false });
  app.addHook(
    "preHandler",
    rateLimitAllRequests(new FixedWindowRateLimiter(), { limitMultiplier: 2 })
  );
  app.post("/auth/login", async () => ({ ok: true }));
  for (let count = 0; count < 60; count += 1) {
    const response = await app.inject({ method: "POST", url: "/auth/login" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["ratelimit-limit"], "60");
  }
  assert.equal((await app.inject({ method: "POST", url: "/auth/login" })).statusCode, 429);
  await app.close();
});
