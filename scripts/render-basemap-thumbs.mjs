/**
 * Renders the 96×56 illustrations on the basemap cards.
 *
 * Nothing describes a map style like the style itself, so the picker prefers a real screenshot
 * over the explicit unavailable preview in `BasemapThumb`. Every card is shot over the *same* viewport,
 * because the question the picker answers is "which of these do I want", and that comparison is
 * impossible if each card shows a different city.
 *
 * Only backgrounds whose licence permits redistribution are rendered. A thumbnail is a derived
 * copy of the provider's cartography, so Esri's imagery and every keyed provider are skipped on
 * purpose rather than for want of a key — their terms do not obviously allow us to ship a
 * picture of their map in this repository. Those cards fall back to the schematic, which is
 * what the fallback is for.
 *
 * Usage: `npm run basemap-thumbs`. Re-run when a background is added or its style changes;
 * the output is committed, so a fresh clone has the pictures without running anything.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { BASEMAPS } from "../packages/layer-sdk/dist/basemaps.js";

const require = createRequire(import.meta.url);
const OUT_DIR = path.join(process.cwd(), "apps/web/public/basemaps");

/**
 * The shared viewport: the Côte d'Azur at z10.
 *
 * It has to make every kind of background say something. Coast tells a satellite mosaic from a
 * street style at a glance, a dense city gives the street styles something to draw, and the
 * Alps rising straight out of the sea is what makes a terrain style look like a terrain style.
 * Somewhere flat and inland would make half the cards identical.
 */
const VIEW = { lng: 13.405, lat: 52.52, zoom: 11 };

/** Backgrounds whose data stops before the shared zoom. GIBS serves the daily VIIRS mosaic to
 *  z8, so at z10 every tile 404s and the card was blank; at z6 the coast still reads. */
const VIEW_OVERRIDES = {
  "gibs-viirs": { zoom: 6 }
};

function viewFor(basemap) {
  return { ...VIEW, ...(VIEW_OVERRIDES[basemap.id] ?? {}) };
}

/** Twice the card's 96×56 so the picture is sharp on a retina screen. */
const SIZE = { width: 192, height: 112 };

/**
 * Licences that let us ship a rendered sample. Everything else falls back to the schematic —
 * see the note above; this list is a licensing decision, not a technical one.
 */
const REDISTRIBUTABLE = new Set([
  // Open data, open styles.
  "openfreemap-liberty",
  "openfreemap-positron",
  "osm-carto",
  "opentopomap",
  "eox-s2cloudless",
  "eox-terrain",
  "gibs-viirs",
  // CARTO publishes its GL styles under BSD and its basemaps are free to use with attribution;
  // the underlying data is OSM under ODbL. These are also the default backgrounds, so a
  // schematic here would be the first thing anyone sees.
  "carto-voyager",
  "carto-dark",
  // OSM-based community styles under CC-BY-SA / open style licences.
  "openfreemap-dark",
  "osm-france",
  "opnvkarte",
  "cyclosm",
  "osm-hot"
]);

function shouldRender(basemap) {
  // A keyed background cannot be rendered without the key anyway, and none of their terms
  // clearly allow republishing a sample.
  if (basemap.proxy || basemap.requiresKey) return false;
  return REDISTRIBUTABLE.has(basemap.id);
}

/** The style a background needs, as MapLibre wants it: a URL for vector, a built raster style
 *  for tiled ones. Mirrors `apps/web/src/map/basemapStyle.ts` for the keyless cases. */
function styleFor(basemap) {
  if (basemap.styleUrl) return basemap.styleUrl;
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: basemap.tiles,
        tileSize: 256,
        maxzoom: basemap.maxzoom ?? 19
      }
    },
    layers: [{ id: "base", type: "raster", source: "base" }]
  };
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/maplibre-gl.css">
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#f3f0e8}
.maplibregl-control-container{display:none}</style>
</head><body><div id="map"></div>
<script src="/maplibre-gl.js"></script>
<script>
window.renderBasemap = (style, view) => new Promise((resolve, reject) => {
  if (window.__map) window.__map.remove();
  const map = new maplibregl.Map({
    container: "map", style, center: [view.lng, view.lat], zoom: view.zoom,
    attributionControl: false, interactive: false, fadeDuration: 0,
    // Needed to read the rendered pixels back for the blankness check below.
    preserveDrawingBuffer: true
  });
  window.__map = map;
  map.on("error", (event) => reject(new Error(event?.error?.message ?? "style failed")));
  // "idle" is the only honest signal that every tile in view has arrived and been drawn;
  // "load" fires while tiles are still coming in and screenshots a half-blank map.
  map.once("idle", () => resolve(true));
});

/** Spread of the rendered pixels. A background that served nothing at this zoom still paints a
 *  canvas — usually flat black or flat beige — and a flat picture is worse on a card than the
 *  explicit unavailable preview, because it looks like a bug rather than a missing file.
 *
 *  The read has to happen inside a render frame. Asking for a preserved drawing buffer is not
 *  enough on its own: outside a frame the buffer has already been cleared, and every background
 *  reads as a uniform blank — which would reject all of them rather than the empty ones. */
window.basemapContrast = () => new Promise((resolve) => {
  window.__map.once("render", () => {
    const source = window.__map.getCanvas();
    const scratch = document.createElement("canvas");
    scratch.width = source.width;
    scratch.height = source.height;
    const context = scratch.getContext("2d");
    // Opaque white underneath, so a transparent region counts as blank paper rather than as
    // black pixels that would read as contrast.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, scratch.width, scratch.height);
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
    let sum = 0;
    let sumOfSquares = 0;
    const samples = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      sum += luma;
      sumOfSquares += luma * luma;
    }
    const mean = sum / samples;
    resolve(Math.sqrt(Math.max(0, sumOfSquares / samples - mean * mean)));
  });
  window.__map.triggerRepaint();
});
</script></body></html>`;

/** Below this the picture carries no information. Chosen from the observed values: the real
 *  thumbnails land above 30, and a background that served nothing sits near 0. */
const MIN_CONTRAST = 6;

async function serveHarness() {
  const maplibreJs = await readFile(require.resolve("maplibre-gl/dist/maplibre-gl.js"));
  const maplibreCss = await readFile(require.resolve("maplibre-gl/dist/maplibre-gl.css"));
  const server = createServer((request, response) => {
    if (request.url === "/maplibre-gl.js") {
      response.writeHead(200, { "content-type": "text/javascript" }).end(maplibreJs);
      return;
    }
    if (request.url === "/maplibre-gl.css") {
      response.writeHead(200, { "content-type": "text/css" }).end(maplibreCss);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const targets = BASEMAPS.filter(shouldRender);
  const skipped = BASEMAPS.length - targets.length;

  const { server, port } = await serveHarness();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);

  const failures = [];
  const blank = [];
  for (const basemap of targets) {
    try {
      await page.evaluate(
        ([style, view]) => window.renderBasemap(style, view),
        [styleFor(basemap), viewFor(basemap)]
      );
      // A style can reach "idle" with its last tiles still decoding; a beat here costs seconds
      // once and avoids a thumbnail with a blank corner committed for good.
      await page.waitForTimeout(600);

      const contrast = await page.evaluate(() => window.basemapContrast());
      if (contrast < MIN_CONTRAST) {
        await rm(path.join(OUT_DIR, `${basemap.id}.webp`), { force: true });
        blank.push(`${basemap.id} (contrast ${contrast.toFixed(1)})`);
        process.stdout.write(`  ${basemap.id} — blank at this zoom, using the fallback\n`);
        continue;
      }

      const webp = await page.screenshot({ type: "webp", quality: 82 });
      await writeFile(path.join(OUT_DIR, `${basemap.id}.webp`), webp);
      process.stdout.write(`  ${basemap.id} — ${(webp.length / 1024).toFixed(1)} kB\n`);
    } catch (error) {
      await rm(path.join(OUT_DIR, `${basemap.id}.webp`), { force: true });
      failures.push(`${basemap.id}: ${error.message}`);
      process.stdout.write(`  ${basemap.id} — failed\n`);
    }
  }

  await browser.close();
  server.close();

  const written = targets.length - failures.length - blank.length;
  process.stdout.write(
    `\n${written}/${targets.length} rendered, ` +
      `${skipped} skipped (keyed or licence-restricted; they use the explicit unavailable preview)\n`
  );
  if (blank.length) {
    // Not a failure: a background whose data does not reach the shared viewport is honestly
    // represented by the schematic, and one shared viewport is the point (§4.8).
    process.stdout.write(
      `\nNo picture at this zoom, so they keep the fallback:\n` +
        `${blank.map((line) => `  ${line}`).join("\n")}\n`
    );
  }
  if (failures.length) {
    process.stdout.write(`\nFailed:\n${failures.map((line) => `  ${line}`).join("\n")}\n`);
    // A missing thumbnail degrades to the fallback rather than breaking the picker, so this is
    // reported and not thrown — but a non-zero exit keeps it from passing unnoticed in CI.
    process.exitCode = 1;
  }
}

await main();
