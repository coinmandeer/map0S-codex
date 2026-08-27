import assert from "node:assert/strict";
import { test, beforeEach, mock } from "node:test";
import { checkEmbeddable, frameSrcAllowlist, __resetEmbedCache } from "./embedService.js";

function respondWith(headers: Record<string, string>, status = 200) {
  return mock.method(globalThis, "fetch", async () => new Response(null, { status, headers }));
}

beforeEach(() => {
  __resetEmbedCache();
  mock.restoreAll();
});

test("known-good hosts are answered without a network call", async () => {
  const fetchMock = respondWith({});
  const probe = await checkEmbeddable("https://cs.m.wikipedia.org/wiki/Oko%C5%99");
  assert.equal(probe.verdict, "allowed");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("hosts known to refuse framing never get probed either", async () => {
  const fetchMock = respondWith({});
  const probe = await checkEmbeddable("https://www.google.com/maps");
  assert.equal(probe.verdict, "blocked");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("x-frame-options blocks whatever its value", async () => {
  for (const value of ["DENY", "SAMEORIGIN", "allow-from https://example.org"]) {
    __resetEmbedCache();
    respondWith({ "x-frame-options": value });
    const probe = await checkEmbeddable("https://example.com/page");
    assert.equal(probe.verdict, "blocked", `expected ${value} to block`);
  }
});

test("csp frame-ancestors is honoured", async () => {
  respondWith({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" });
  assert.equal((await checkEmbeddable("https://a.example/page")).verdict, "blocked");

  __resetEmbedCache();
  respondWith({ "content-security-policy": "frame-ancestors *" });
  assert.equal((await checkEmbeddable("https://b.example/page")).verdict, "allowed");
});

test("a page with no framing headers is embeddable", async () => {
  respondWith({});
  assert.equal((await checkEmbeddable("https://c.example/page")).verdict, "allowed");
});

test("the verdict is cached, so opening the same place twice probes once", async () => {
  const fetchMock = respondWith({});
  await checkEmbeddable("https://d.example/page?a=1");
  await checkEmbeddable("https://d.example/page?a=2");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("an unreachable page is unknown rather than allowed", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal((await checkEmbeddable("https://e.example/page")).verdict, "unknown");
});

test("plain http and malformed urls are refused before any request", async () => {
  const fetchMock = respondWith({});
  assert.equal((await checkEmbeddable("http://f.example/page")).verdict, "blocked");
  assert.equal((await checkEmbeddable("not a url")).verdict, "blocked");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("every allowlisted frame-src origin is https", () => {
  for (const origin of frameSrcAllowlist()) {
    assert.match(origin, /^https:\/\//, `${origin} must be https`);
  }
});
