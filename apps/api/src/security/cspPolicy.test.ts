import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { frameSrcAllowlist } from "../services/embedService.js";
import { CSP_REPORT_PUBLIC_PATH } from "./cspReporting.js";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name!, values] as const;
      })
  );
}

test("production CSP stays synchronized with the embed allowlist and reporting endpoint", async () => {
  const source = await readFile(
    new URL("../../../../infra/security-headers.inc", import.meta.url),
    "utf8"
  );
  const match = source.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/);
  assert.ok(match, "production Content-Security-Policy header not found");
  const policy = directives(match[1]!);

  assert.deepEqual(policy.get("script-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("report-uri"), [CSP_REPORT_PUBLIC_PATH]);
  assert.deepEqual(
    [...(policy.get("frame-src") ?? [])].sort(),
    [...frameSrcAllowlist()].sort(),
    "every probed embed host must be framed by CSP, and no extra frame host may bypass the probe"
  );
});
