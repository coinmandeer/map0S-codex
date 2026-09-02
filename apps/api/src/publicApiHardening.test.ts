import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./index.js";
import { CSP_REPORT_API_PATH, CSP_REPORT_CONTENT_TYPE } from "./security/cspReporting.js";

test("production app applies exact CORS, request schemas and canonicalize authorization", async () => {
  const app = await buildApp({
    logger: false,
    corsOrigins: ["https://allowed.mapos.test"],
    trustedProxies: "loopback",
    prototypeStakingEnabled: false
  });

  const allowedPreflight = await app.inject({
    method: "OPTIONS",
    url: "/auth/guest",
    headers: {
      origin: "https://allowed.mapos.test",
      "access-control-request-method": "POST"
    }
  });
  assert.equal(allowedPreflight.statusCode, 204);
  assert.equal(
    allowedPreflight.headers["access-control-allow-origin"],
    "https://allowed.mapos.test"
  );
  assert.equal(allowedPreflight.headers["access-control-allow-credentials"], "true");

  const allowedRead = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://allowed.mapos.test" }
  });
  assert.match(String(allowedRead.headers["x-request-id"] ?? ""), /^[a-f0-9-]{36}$/i);
  assert.equal(allowedRead.headers["access-control-expose-headers"], "X-Request-ID");

  const deniedPreflight = await app.inject({
    method: "OPTIONS",
    url: "/auth/guest",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST"
    }
  });
  assert.equal(deniedPreflight.headers["access-control-allow-origin"], undefined);
  assert.equal(deniedPreflight.headers["access-control-allow-credentials"], undefined);

  const rejectedMutation = await app.inject({
    method: "POST",
    url: "/places/canonicalize",
    headers: {
      origin: "https://attacker.example",
      "content-type": "application/json"
    },
    payload: { name: "Valid place", lng: 14.4, lat: 50.1 }
  });
  assert.equal(rejectedMutation.statusCode, 403);

  const sameOriginMutation = await app.inject({
    method: "POST",
    url: "/places/canonicalize",
    headers: {
      host: "mapos.local:4032",
      origin: "http://mapos.local:4032",
      "content-type": "application/json"
    },
    payload: { name: "Valid place", lng: 14.4, lat: 50.1 }
  });
  assert.equal(sameOriginMutation.statusCode, 401);

  const proxiedSameOriginMutation = await app.inject({
    method: "POST",
    url: "/places/canonicalize",
    headers: {
      host: "mapos.example",
      "x-forwarded-host": "mapos.example",
      "x-forwarded-proto": "https",
      origin: "https://mapos.example",
      "content-type": "application/json"
    },
    payload: { name: "Valid place", lng: 14.4, lat: 50.1 }
  });
  assert.equal(proxiedSameOriginMutation.statusCode, 401);

  const badRegister = await app.inject({
    method: "POST",
    url: "/auth/register",
    headers: { "content-type": "application/json" },
    payload: { email: "not-an-email", password: "long-enough" }
  });
  assert.equal(badRegister.statusCode, 400);

  const badGuest = await app.inject({
    method: "POST",
    url: "/auth/guest",
    headers: { "content-type": "application/json" },
    payload: []
  });
  assert.equal(badGuest.statusCode, 400);

  const badCanonicalize = await app.inject({
    method: "POST",
    url: "/places/canonicalize",
    headers: { "content-type": "application/json" },
    payload: { name: "Invalid", lng: 181, lat: 0 }
  });
  assert.equal(badCanonicalize.statusCode, 400);

  const unauthorizedCanonicalize = await app.inject({
    method: "POST",
    url: "/places/canonicalize",
    headers: { "content-type": "application/json" },
    payload: { name: "Valid place", lng: 14.4, lat: 50.1 }
  });
  assert.equal(unauthorizedCanonicalize.statusCode, 401);

  const cspReport = await app.inject({
    method: "POST",
    url: CSP_REPORT_API_PATH,
    headers: { "content-type": CSP_REPORT_CONTENT_TYPE },
    payload: JSON.stringify({
      "csp-report": {
        "document-uri": "https://allowed.mapos.test/private?secret=redacted",
        "blocked-uri": "inline",
        "effective-directive": "script-src-elem",
        disposition: "enforce",
        "status-code": 200
      }
    })
  });
  assert.equal(cspReport.statusCode, 204);

  const hiddenStaking = await app.inject({ method: "GET", url: "/game/staking/overview" });
  assert.equal(hiddenStaking.statusCode, 404);
  await app.close();
});

test("prototype staking routes exist only behind their explicit feature gate", async () => {
  const app = await buildApp({
    logger: false,
    corsOrigins: [],
    trustedProxies: false,
    prototypeStakingEnabled: true
  });
  const response = await app.inject({ method: "GET", url: "/game/staking/overview" });
  assert.equal(response.statusCode, 401);
  await app.close();
});
