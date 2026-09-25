import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseIdentity } from "./check-release-identity.mjs";

const health = { status: "ok", service: "mapos-v3", release: "20260923-candidate" };
test("accepts the same named release from the API, web and requested candidate", () => {
  assert.equal(
    checkReleaseIdentity(health, { release: health.release }, health.release),
    health.release
  );
});
test("rejects a stale web, stale candidate, unhealthy API and unversioned deployment", () => {
  assert.throws(() => checkReleaseIdentity(health, { release: "older" }), /releases differ/);
  assert.throws(
    () => checkReleaseIdentity(health, { release: health.release }, "newer"),
    /candidate/
  );
  assert.throws(
    () => checkReleaseIdentity({ ...health, status: "error" }, { release: health.release }),
    /healthy/
  );
  for (const release of [undefined, "", "development", "unknown-release"]) {
    assert.throws(() => checkReleaseIdentity({ ...health, release }, { release }));
  }
  assert.throws(
    () => checkReleaseIdentity({ ...health, service: "other" }, { release: health.release }),
    /service/
  );
});
