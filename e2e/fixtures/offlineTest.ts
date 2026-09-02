import { expect, test as base } from "@playwright/test";

const EMPTY_MAP_STYLE = JSON.stringify({
  version: 8,
  name: "MapOS offline fixture",
  sources: {},
  layers: [
    {
      id: "offline-background",
      type: "background",
      paint: { "background-color": "#f3f0e8" }
    }
  ]
});

const BROWSER_FIXTURES = new Map([
  ["https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json", EMPTY_MAP_STYLE],
  ["https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", EMPTY_MAP_STYLE],
  [
    "https://api.rainviewer.com/public/weather-maps.json",
    JSON.stringify({ radar: { past: [], nowcast: [] } })
  ]
]);

const EMPTY_TILEJSON = JSON.stringify({
  tilejson: "3.0.0",
  name: "MapOS offline vector fixture",
  tiles: [],
  minzoom: 0,
  maxzoom: 22
});

// A valid transparent PNG keeps raster/image layers in their normal lifecycle while transferring
// no provider data. It is intentionally tiny because E2E verifies MapOS behavior, not
// third-party cartography or flag artwork.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+T0YvWQAAAABJRU5ErkJggg==",
  "base64"
);

function browserFixture(url: URL): { body: string | Buffer; contentType: string } | null {
  const exact = BROWSER_FIXTURES.get(url.href);
  if (exact !== undefined) return { body: exact, contentType: "application/json" };
  if (
    url.origin === "https://tiles.basemaps.cartocdn.com" &&
    url.pathname === "/vector/carto.streets/v1/tiles.json" &&
    url.search === ""
  ) {
    return { body: EMPTY_TILEJSON, contentType: "application/json" };
  }
  if (
    url.origin === "https://a.basemaps.cartocdn.com" &&
    /^\/(?:light|dark)_only_labels\/\d+\/\d+\/\d+@2x\.png$/.test(url.pathname) &&
    url.search === ""
  ) {
    return { body: TRANSPARENT_PNG, contentType: "image/png" };
  }
  if (
    [
      "https://a.tile.openstreetmap.org",
      "https://b.tile.openstreetmap.org",
      "https://c.tile.openstreetmap.org"
    ].includes(url.origin) &&
    /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname) &&
    url.search === ""
  ) {
    return { body: TRANSPARENT_PNG, contentType: "image/png" };
  }
  if (
    [
      "https://a.tile-cyclosm.openstreetmap.fr",
      "https://b.tile-cyclosm.openstreetmap.fr",
      "https://c.tile-cyclosm.openstreetmap.fr"
    ].includes(url.origin) &&
    /^\/cyclosm\/\d+\/\d+\/\d+\.png$/.test(url.pathname) &&
    url.search === ""
  ) {
    return { body: TRANSPARENT_PNG, contentType: "image/png" };
  }
  if (
    url.origin === "https://tile.waymarkedtrails.org" &&
    /^\/hiking\/\d+\/\d+\/\d+\.png$/.test(url.pathname) &&
    url.search === ""
  ) {
    return { body: TRANSPARENT_PNG, contentType: "image/png" };
  }
  if (
    url.origin === "https://flagcdn.com" &&
    /^\/w40\/[a-z]{2}\.png$/.test(url.pathname) &&
    url.search === ""
  ) {
    return { body: TRANSPARENT_PNG, contentType: "image/png" };
  }
  return null;
}

function isLoopback(url: URL) {
  return (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname) ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  );
}

export interface OfflineNetworkLog {
  fulfilledFixtures: string[];
  unexpectedExternal: string[];
}

export const test = base.extend<{ offlineNetwork: OfflineNetworkLog }>({
  offlineNetwork: [
    async ({ context, page }, use) => {
      const log: OfflineNetworkLog = { fulfilledFixtures: [], unexpectedExternal: [] };

      // Context routing also covers child frames and any popup a scenario opens. A targeted
      // `page.route(...)` remains more specific and intentionally wins for that scenario.
      await context.route("**/*", async (route) => {
        const raw = route.request().url();
        const url = new URL(raw);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          await route.continue();
          return;
        }
        if (isLoopback(url)) {
          await route.continue();
          return;
        }

        const fixture = browserFixture(url);
        if (fixture) {
          log.fulfilledFixtures.push(`${url.origin}${url.pathname}`);
          await route.fulfill({
            status: 200,
            contentType: fixture.contentType,
            headers: { "access-control-allow-origin": "*" },
            body: fixture.body
          });
          return;
        }

        // Store only origin + path. Provider query strings can carry keys and never belong in a
        // failed test artifact.
        log.unexpectedExternal.push(`${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
      });

      const watchSockets = (candidate: typeof page) => {
        candidate.on("websocket", (socket) => {
          const url = new URL(socket.url());
          if (!isLoopback(url)) log.unexpectedExternal.push(`${url.origin}${url.pathname}`);
        });
      };
      watchSockets(page);
      context.on("page", watchSockets);

      await use(log);

      expect(
        [...new Set(log.unexpectedExternal)],
        "offline E2E attempted an external request with no recorded fixture"
      ).toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };
export type { Page } from "@playwright/test";
