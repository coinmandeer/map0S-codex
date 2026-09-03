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

/** A zero-byte body is a valid empty vector tile: MapLibre treats it as loaded and draws
 *  nothing, which is what an offline run wants from a tile it must not fetch. */
const EMPTY_MVT = Buffer.alloc(0);

/** Terrarium reads elevation as `(R * 256 + G + B / 256) - 32768` metres, so a solid
 *  `rgb(128, 0, 0)` tile is exactly sea level. A transparent PNG would decode to −32768 m and
 *  send the terrain mesh through the floor, which looks like a bug in our code rather than an
 *  absent fixture. 256 × 256 so the DEM source gets the tile size it expects. */
const TERRARIUM_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAB+0lEQVR42u3TQQkAAAjAwEU3un8reHAJBmsK3pIAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgAJMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAyAASTAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADADHAnGpB4FDLHHvAAAAAElFTkSuQmCC",
  "base64"
);

/** `{z}/{x}/{y}` with an extension, which is every tile path MapOS asks for. */
const XYZ = String.raw`\d+\/\d+\/\d+`;

/**
 * Tile and asset fixtures, as a table.
 *
 * Every entry used to be its own `if`, and the cost of that showed up as four legend specs
 * failing the moment an overlay was switched on in a test for the first time: adding a layer
 * and forgetting its fixture looks like a passing suite until something enables it. One row per
 * host makes the omission visible, and keeps a new layer to a one-line change.
 *
 * Subdomained hosts (`a.`/`b.`/`c.`) are matched by pattern rather than listed, because which
 * subdomain a tile lands on is not ours to predict.
 */
const ASSET_FIXTURES: Array<{
  origin: RegExp;
  path: RegExp;
  body: Buffer;
  contentType: string;
}> = [
  // Basemap label overlays and the OSM raster background.
  {
    origin: /^https:\/\/[a-c]\.basemaps\.cartocdn\.com$/,
    path: new RegExp(String.raw`^\/(?:light|dark)_only_labels\/${XYZ}@2x\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/[a-c]\.tile\.openstreetmap\.org$/,
    path: new RegExp(String.raw`^\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  // EOX's Sentinel-2 mosaic, the keyless imagery background. The body is a PNG even though the
  // path ends `.jpg`; the browser decodes by the declared type, not the extension.
  {
    origin: /^https:\/\/tiles\.maps\.eox\.at$/,
    path: new RegExp(
      String.raw`^\/wmts\/1\.0\.0\/[\w-]+\/default\/GoogleMapsCompatible\/${XYZ}\.jpg$`
    ),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  // The six structural raster overlays. Waymarked Trails swaps the path per activity, so all
  // five networks are matched rather than only the default.
  {
    origin: /^https:\/\/[a-c]\.tile-cyclosm\.openstreetmap\.fr$/,
    path: new RegExp(String.raw`^\/cyclosm\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/tile\.waymarkedtrails\.org$/,
    path: new RegExp(String.raw`^\/(?:hiking|cycling|mtb|riding|slopes)\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/[a-c]\.tiles\.openrailwaymap\.org$/,
    path: new RegExp(String.raw`^\/standard\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/tiles\.openseamap\.org$/,
    path: new RegExp(String.raw`^\/seamark\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/[a-c]\.tile\.opentopomap\.org$/,
    path: new RegExp(String.raw`^\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/tiles\.opensnowmap\.org$/,
    path: new RegExp(String.raw`^\/pistes\/${XYZ}\.png$`),
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  },
  // Vector overlays. A zero-byte MVT is a valid empty tile: MapLibre treats it as loaded and
  // draws nothing, so the layer keeps its normal lifecycle with no provider data transferred.
  {
    origin: /^https:\/\/openinframap\.org$/,
    path: new RegExp(String.raw`^\/tiles\/${XYZ}\.pbf$`),
    body: EMPTY_MVT,
    contentType: "application/x-protobuf"
  },
  {
    origin: /^https:\/\/tiles\.macrostrat\.org$/,
    path: new RegExp(String.raw`^\/carto\/${XYZ}\.mvt$`),
    body: EMPTY_MVT,
    contentType: "application/x-protobuf"
  },
  // The elevation model behind 3D terrain and hillshade.
  {
    origin: /^https:\/\/s3\.amazonaws\.com$/,
    path: new RegExp(String.raw`^\/elevation-tiles-prod\/terrarium\/${XYZ}\.png$`),
    body: TERRARIUM_PNG,
    contentType: "image/png"
  },
  {
    origin: /^https:\/\/flagcdn\.com$/,
    path: /^\/w40\/[a-z]{2}\.png$/,
    body: TRANSPARENT_PNG,
    contentType: "image/png"
  }
];

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
  for (const fixture of ASSET_FIXTURES) {
    if (fixture.origin.test(url.origin) && fixture.path.test(url.pathname) && url.search === "") {
      return { body: fixture.body, contentType: fixture.contentType };
    }
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
