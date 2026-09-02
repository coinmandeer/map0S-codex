import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExternalNetworkAllowed,
  createOfflineFetchGuard,
  isLoopbackRequest,
  isOfflineFixtureMode
} from "./offlineFixtureMode.js";
import {
  __resetUpstreamCache,
  __setUpstreamTestDependencies,
  fetchJson
} from "./utils/upstream.js";

test("offline fixture mode is explicit and does not change the default server", () => {
  assert.equal(isOfflineFixtureMode({}), false);
  assert.equal(isOfflineFixtureMode({ MAPOS_FIXTURE_MODE: "recorded" }), false);
  assert.equal(isOfflineFixtureMode({ MAPOS_FIXTURE_MODE: "offline" }), true);
});

test("offline fetch guard permits loopback requests", async () => {
  const calls: string[] = [];
  const delegate = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    return new Response("fixture");
  }) as typeof fetch;
  const guarded = createOfflineFetchGuard(delegate);

  assert.equal(await (await guarded("http://127.0.0.1:4033/health")).text(), "fixture");
  assert.equal(await (await guarded("http://localhost:5173/")).text(), "fixture");
  assert.equal(calls.length, 2);
});

test("offline fetch guard blocks external HTTP(S) without calling the delegate", async () => {
  let delegated = false;
  const delegate = (async () => {
    delegated = true;
    return new Response("unexpected");
  }) as typeof fetch;
  const guarded = createOfflineFetchGuard(delegate);

  await assert.rejects(
    guarded("https://api.open-meteo.com/v1/forecast?secret=do-not-log"),
    /blocked outbound fetch to https:\/\/api\.open-meteo\.com/
  );
  assert.equal(delegated, false);
});

test("loopback detection rejects lookalike and public destinations", () => {
  assert.equal(isLoopbackRequest("http://127.0.0.1:4033/health"), true);
  assert.equal(isLoopbackRequest("http://[::1]:5173/"), true);
  assert.equal(isLoopbackRequest("https://preview.localhost/test"), true);
  assert.equal(isLoopbackRequest("https://localhost.example.com/"), false);
  assert.equal(isLoopbackRequest("https://1.1.1.1/"), false);
  assert.equal(isLoopbackRequest("data:text/plain,fixture"), true);
  assert.equal(isLoopbackRequest("ftp://example.com/archive"), false);
});

test("offline mode blocks the pinned transport before DNS or request delegation", async () => {
  const originalMode = process.env.MAPOS_FIXTURE_MODE;
  let dnsCalls = 0;
  let requestCalls = 0;
  process.env.MAPOS_FIXTURE_MODE = "offline";
  __resetUpstreamCache();
  __setUpstreamTestDependencies({
    resolveHost: async () => {
      dnsCalls += 1;
      return ["93.184.216.34"];
    },
    request: async () => {
      requestCalls += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }
  });
  try {
    assert.throws(() => assertExternalNetworkAllowed(), /Offline fixture mode blocked/);
    await assert.rejects(
      fetchJson("https://provider.test/data", { providerId: "offline-guard-test" }),
      /Offline fixture mode blocked/
    );
    assert.equal(dnsCalls, 0);
    assert.equal(requestCalls, 0);
  } finally {
    __resetUpstreamCache();
    if (originalMode === undefined) delete process.env.MAPOS_FIXTURE_MODE;
    else process.env.MAPOS_FIXTURE_MODE = originalMode;
  }
});
