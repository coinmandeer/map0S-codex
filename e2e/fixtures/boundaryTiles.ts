import type { Page } from "@playwright/test";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

type Level = "country" | "adm1" | "adm2" | "lau";

/** One administrative area as the boundary tiles carry it: the id is the JSON tuple the overlay
 *  expects, and the bbox travels in the properties so a click can frame the area. */
export function boundaryArea(
  code: string,
  name: string,
  level: Level,
  ring: number[][]
): GeoJSON.Feature<GeoJSON.Polygon> {
  const lngs = ring.map(([lng]) => lng!);
  const lats = ring.map(([, lat]) => lat!);
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  return {
    type: "Feature",
    properties: {
      id: JSON.stringify(["fixture", "CZ", level, code]),
      source: "fixture",
      country: "CZ",
      west,
      south,
      east,
      north,
      code,
      name,
      level,
      lng: (west + east) / 2,
      lat: (south + north) / 2
    },
    geometry: { type: "Polygon", coordinates: [ring] }
  };
}

/**
 * Serves the Discover boundary manifest and its vector tiles from fixture areas, the way the
 * boundary service would. Every level gets the same areas, so a test does not have to know which
 * level the map picks at its zoom.
 */
export async function stubBoundaryTiles(
  page: Page,
  areas: GeoJSON.Feature[],
  revision = "d".repeat(64)
): Promise<void> {
  const index = geojsonvt({ type: "FeatureCollection", features: areas }, { maxZoom: 14 });
  await page.route("**/v2/discover/boundaries", (route) =>
    route.fulfill({
      headers: { "cache-control": "no-store" },
      json: {
        ready: true,
        revision,
        tileTemplate: `/v2/discover/boundaries/${revision}/{level}/{z}/{x}/{y}.mvt`,
        coverage: (["country", "adm1", "adm2", "lau"] as const).map((level) => ({
          country: "CZ",
          level,
          count: areas.length
        }))
      }
    })
  );
  await page.route("**/v2/discover/boundaries/**/*.mvt", (route) => {
    const match = /\/(\d+)\/(\d+)\/(\d+)\.mvt/.exec(route.request().url())!;
    const tile = index.getTile(Number(match[1]), Number(match[2]), Number(match[3]));
    return route.fulfill({
      contentType: "application/vnd.mapbox-vector-tile",
      body: tile ? Buffer.from(vtpbf.fromGeojsonVt({ boundaries: tile })) : Buffer.alloc(0)
    });
  });
}

/** How many boundary areas the map has drawn at a point (or anywhere, without one). */
export function renderedBoundaryAreas(page: Page, at?: [number, number]): Promise<number> {
  return page.evaluate((point) => {
    const map = window.__maposMap;
    const layers =
      map
        ?.getStyle()
        ?.layers.filter((l) => /^discover-boundary-\d+-fill$/u.test(l.id))
        .map((l) => l.id) ?? [];
    if (!map || !layers.length) return 0;
    const hits = point
      ? map.queryRenderedFeatures(map.project(point), { layers })
      : map.queryRenderedFeatures({ layers });
    return new Set(hits.map((f) => f.properties.id)).size;
  }, at);
}
