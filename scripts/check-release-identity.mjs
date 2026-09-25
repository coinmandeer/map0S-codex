import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function checkReleaseIdentity(health, web, expected) {
  assert.equal(health?.status, "ok", "API is not healthy");
  assert.equal(health?.service, "mapos-v3", "Unexpected API service");
  assert.match(
    health?.release ?? "",
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Missing or invalid API release"
  );
  assert.ok(
    !["development", "unknown-release"].includes(health.release),
    "Unversioned API release"
  );
  assert.equal(web?.release, health.release, "Web and API releases differ");
  if (expected) assert.equal(health.release, expected, "Running release differs from candidate");
  return health.release;
}

// Also runnable through stdin inside the API container, avoiding a host Node dependency.
if (
  process.argv[1] === "-" ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  try {
    const [expected, health, web] = process.argv.slice(2);
    console.log(
      `release_identity=pass release=${checkReleaseIdentity(JSON.parse(health), JSON.parse(web), expected)}`
    );
  } catch (error) {
    console.error(`release_identity=fail: ${error.message}`);
    process.exitCode = 1;
  }
}
