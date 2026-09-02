import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  CSP_REPORT_API_PATH,
  CSP_REPORT_BODY_LIMIT,
  CSP_REPORT_CONTENT_TYPE,
  registerCspReporting,
  type CspViolationSignal
} from "./cspReporting.js";

test("accepts a browser CSP report and exposes only bounded query-free metadata", async () => {
  const received: CspViolationSignal[] = [];
  const app = Fastify({ logger: false });
  registerCspReporting(app, { onViolation: (signal) => received.push(signal) });

  const response = await app.inject({
    method: "POST",
    url: CSP_REPORT_API_PATH,
    headers: { "content-type": CSP_REPORT_CONTENT_TYPE },
    payload: JSON.stringify({
      "csp-report": {
        "document-uri": "https://mapos.test/private/path?token=must-not-survive",
        "blocked-uri": "https://attacker.invalid/script.js?secret=must-not-survive",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src 'self'",
        disposition: "enforce",
        "status-code": 200,
        "source-file": "https://mapos.test/assets/app.js?private=value",
        "line-number": 42
      }
    })
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, "");
  assert.deepEqual(received, [
    {
      documentOrigin: "https://mapos.test",
      blockedResource: "https://attacker.invalid",
      effectiveDirective: "script-src-elem",
      disposition: "enforce",
      statusCode: 200
    }
  ]);
  await app.close();
});

test("rejects malformed and oversized report bodies", async () => {
  const app = Fastify({ logger: false });
  registerCspReporting(app);

  const malformed = await app.inject({
    method: "POST",
    url: CSP_REPORT_API_PATH,
    headers: { "content-type": CSP_REPORT_CONTENT_TYPE },
    payload: "{not-json"
  });
  assert.equal(malformed.statusCode, 400);

  const missingDirective = await app.inject({
    method: "POST",
    url: CSP_REPORT_API_PATH,
    headers: { "content-type": "application/json" },
    payload: { "csp-report": { "blocked-uri": "inline" } }
  });
  assert.equal(missingDirective.statusCode, 400);

  const oversized = await app.inject({
    method: "POST",
    url: CSP_REPORT_API_PATH,
    headers: { "content-type": CSP_REPORT_CONTENT_TYPE },
    payload: JSON.stringify({
      "csp-report": {
        "effective-directive": "script-src",
        padding: "x".repeat(CSP_REPORT_BODY_LIMIT)
      }
    })
  });
  assert.equal(oversized.statusCode, 413);
  await app.close();
});
