import assert from "node:assert/strict";
import { test, beforeEach, afterEach, mock } from "node:test";
import { checkEmbeddable, frameSrcAllowlist, __resetEmbedCache } from "./embedService.js";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../utils/upstream.js";

function respondWith(headers: Record<string, string>, status = 200) {
  return mock.method(globalThis, "fetch", async () => new Response(null, { status, headers }));
}

beforeEach(() => {
  __resetEmbedCache();
  mock.restoreAll();
  __resetUpstreamCache();
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal,
        redirect: "manual"
      })
  });
});

afterEach(() => __resetUpstreamCache());

test("known-good hosts are answered without a network call", async () => {
  const fetchMock = respondWith({});
  const urls = [
    "https://cs.m.wikipedia.org/wiki/Oko%C5%99",
    "https://www.openstreetmap.org/export/embed.html",
    "https://www.mapillary.com/embed",
    "https://embed.windy.com/embed2.html"
  ];
  for (const url of urls) assert.equal((await checkEmbeddable(url)).verdict, "allowed");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a known blocked host is refused without a network call", async () => {
  const fetchMock = respondWith({});
  const probe = await checkEmbeddable("https://www.google.com/maps");
  assert.equal(probe.verdict, "blocked");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("x-frame-options blocks whatever its value", async () => {
  const values = ["DENY", "SAMEORIGIN", "allow-from https://example.org"];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const index = Number(new URL(String(input)).pathname.split("/").pop());
    return new Response(null, { headers: { "x-frame-options": values[index] ?? "DENY" } });
  });
  for (const [index, value] of values.entries()) {
    const probe = await checkEmbeddable(`https://www.youtube-nocookie.com/embed/${index}`);
    assert.equal(probe.verdict, "blocked", `expected ${value} to block`);
  }
});

test("csp frame-ancestors is honoured", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const blocked = new URL(String(input)).pathname.endsWith("blocked");
    const csp = blocked ? "default-src 'self'; frame-ancestors 'none'" : "frame-ancestors *";
    return new Response(null, { headers: { "content-security-policy": csp } });
  });
  assert.equal(
    (await checkEmbeddable("https://www.youtube-nocookie.com/embed/blocked")).verdict,
    "blocked"
  );
  assert.equal(
    (await checkEmbeddable("https://www.youtube-nocookie.com/embed/allowed")).verdict,
    "allowed"
  );
});

test("a page with no framing headers is embeddable", async () => {
  respondWith({});
  assert.equal(
    (await checkEmbeddable("https://www.youtube-nocookie.com/embed/no-headers")).verdict,
    "allowed"
  );
});

test("the verdict is cached, so opening the same place twice probes once", async () => {
  const fetchMock = respondWith({});
  await checkEmbeddable("https://www.youtube-nocookie.com/embed/cached?a=1");
  await checkEmbeddable("https://www.youtube-nocookie.com/embed/cached?a=2");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("an unreachable page is unknown rather than allowed", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(
    (await checkEmbeddable("https://www.youtube-nocookie.com/embed/unreachable")).verdict,
    "unknown"
  );
});

test("plain http and malformed urls are refused before any request", async () => {
  const fetchMock = respondWith({});
  assert.equal((await checkEmbeddable("http://f.example/page")).verdict, "blocked");
  assert.equal((await checkEmbeddable("not a url")).verdict, "blocked");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("credentials, non-default ports and non-allowlisted hosts are refused without a request", async () => {
  const fetchMock = respondWith({});
  const cases = [
    "https://user:secret@www.openstreetmap.org/export/embed.html",
    "https://www.openstreetmap.org:8443/export/embed.html",
    "https://example.com/page",
    "https://www.openstreetmap.org.evil.example/page"
  ];
  for (const url of cases) assert.equal((await checkEmbeddable(url)).verdict, "blocked");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("localhost and non-public IP spellings are refused without a request", async () => {
  const fetchMock = respondWith({});
  const cases = [
    "https://localhost/page",
    "https://service.localhost/page",
    "https://127.0.0.1/page",
    "https://0x7f000001/page",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/page",
    "https://[::1]/page",
    "https://[fc00::1]/page"
  ];
  for (const url of cases) {
    const probe = await checkEmbeddable(url);
    assert.equal(probe.verdict, "blocked", `${url} must be blocked`);
    assert.equal(probe.reason, "private or local address");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("redirects are followed manually only while every destination stays allowlisted", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) {
      return new Response(null, { status: 302, headers: { location: "/embed/final" } });
    }
    return new Response(null);
  });

  const probe = await checkEmbeddable("https://www.youtube-nocookie.com/embed/start");
  assert.equal(probe.verdict, "allowed");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.init?.redirect, "manual");
  assert.equal(requests[1]?.url, "https://www.youtube-nocookie.com/embed/final");
});

test("a redirect to a private or unapproved destination is blocked before connecting", async () => {
  for (const destination of ["https://127.0.0.1/admin", "https://example.com/"]) {
    __resetEmbedCache();
    mock.restoreAll();
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 302, headers: { location: destination } })
    );
    const probe = await checkEmbeddable("https://www.youtube-nocookie.com/embed/redirect");
    assert.equal(probe.verdict, "blocked");
    assert.match(probe.reason, /^redirect rejected:/);
    assert.equal(fetchMock.mock.callCount(), 1);
  }
});

test("GET fallback requests one byte and refuses an oversized response", async () => {
  const requests: RequestInit[] = [];
  mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(init ?? {});
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    return new Response(null, { headers: { "content-length": "65537" } });
  });

  const probe = await checkEmbeddable("https://www.youtube-nocookie.com/embed/large");
  assert.equal(probe.verdict, "unknown");
  assert.equal(probe.reason, "probe response too large");
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.headers).get("range"), "bytes=0-0");
  assert.equal(requests[1]?.redirect, "manual");
});

test("every allowlisted frame-src origin is https", () => {
  for (const origin of frameSrcAllowlist()) {
    assert.match(origin, /^https:\/\//, `${origin} must be https`);
  }
});
