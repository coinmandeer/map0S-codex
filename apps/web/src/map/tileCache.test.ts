import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedTileTemplate,
  loadTile,
  resetTileCache,
  tileCacheSize,
  unwrapTileUrl
} from "./tileCache";

/**
 * The protocol handler itself needs MapLibre, so what is exercised here is the wrapping and the
 * sharing — which is where the behaviour worth protecting lives. `loadTile` is reached through
 * the module's own fetch, stubbed per test.
 */
test("an http template is wrapped, and the placeholders survive it", () => {
  const wrapped = cachedTileTemplate(
    "https://example.wms/service?request=GetMap&bbox={bbox-epsg-3857}"
  );
  assert.equal(
    wrapped,
    "mapos-tile://https://example.wms/service?request=GetMap&bbox={bbox-epsg-3857}"
  );
  // MapLibre substitutes the extent before the handler runs, so the braces must stay literal.
  assert.ok(wrapped.includes("{bbox-epsg-3857}"));
  assert.equal(
    unwrapTileUrl(wrapped),
    "https://example.wms/service?request=GetMap&bbox={bbox-epsg-3857}"
  );
});

test("fresh tiles reuse bytes; expired tiles revalidate and no-store is never retained", async (t) => {
  resetTileCache();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    if (calls === 1)
      return new Response("tile", { headers: { "cache-control": "max-age=0", etag: "v1" } });
    if (calls === 2) {
      assert.equal(new Headers(init.headers).get("if-none-match"), "v1");
      return new Response(null, { status: 304, headers: { "cache-control": "max-age=60" } });
    }
    return new Response("private", { headers: { "cache-control": "no-store" } });
  });
  const signal = new AbortController().signal;
  const first = await loadTile("https://tiles.test/a", signal);
  assert.equal((await loadTile("https://tiles.test/a", signal)).data, first.data);
  await loadTile("https://tiles.test/a", signal);
  assert.equal(calls, 2);
  await loadTile("https://tiles.test/b", signal);
  await loadTile("https://tiles.test/b", signal);
  assert.equal(calls, 4);
  assert.equal(tileCacheSize(), 1);
  resetTileCache();
});

test("shared transport survives one cancellation and aborts after its last consumer", async (t) => {
  resetTileCache();
  let transport: AbortSignal | undefined;
  let calls = 0;
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => {
    calls++;
    transport = init.signal!;
    return new Promise<Response>((_resolve, reject) => {
      transport!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = loadTile("https://tiles.test/shared", a.signal);
  const second = loadTile("https://tiles.test/shared", b.signal);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  a.abort();
  await firstRejected;
  assert.equal(transport?.aborted, false);
  assert.equal(calls, 1);
  b.abort();
  await secondRejected;
  assert.equal(transport?.aborted, true);
  resetTileCache();
});

test("a scheme MapLibre already handles is left alone", () => {
  // PMTiles has its own protocol; wrapping it would route range reads through a plain fetch.
  assert.equal(
    cachedTileTemplate("pmtiles://https://x.org/a.pmtiles/{z}/{x}/{y}"),
    "pmtiles://https://x.org/a.pmtiles/{z}/{x}/{y}"
  );
  assert.equal(cachedTileTemplate("mapbox://x"), "mapbox://x");
});

test("unwrapping a plain URL is a no-op, so the handler is safe either way", () => {
  assert.equal(unwrapTileUrl("https://x.org/1/2/3.png"), "https://x.org/1/2/3.png");
});

test("the cache starts and resets empty", () => {
  resetTileCache();
  assert.equal(tileCacheSize(), 0);
});
