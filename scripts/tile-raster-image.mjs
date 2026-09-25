#!/usr/bin/env node
/**
 * Turns one raster image into a self-hosted PMTiles archive (tier 2).
 *
 * The plan's "funny maps" tier: a picture that describes a region — an election result, a
 * wine/beer cartoon of Europe, a pharmacy-density chart — is a single image plus the bounds it
 * covers. This script makes it a tile pyramid MapOS serves from its own origin, so the browser
 * downloads only the tiles in view instead of one large PNG.
 *
 * What happens here, at build time only:
 *  1. The source image is treated as the given bbox in Web Mercator (EPSG:3857). A GeoTIFF's
 *     own georeferencing is not read; pass the bounds explicitly or in a sidecar manifest.
 *  2. For every zoom from `--min-zoom` to `--max-zoom`, the tiles intersecting the bbox are
 *     cropped out of the source and resized to 256 px with sharp.
 *  3. The tiles are written as one PMTiles v3 archive (a minimal writer lives here — the npm
 *     `pmtiles` package is read-only by design) to `apps/web/public/`, which nginx serves with
 *     immutable caching.
 *
 * Usage:
 *   node scripts/tile-raster-image.mjs --input europe-wine.png \
 *     --bbox -10.5,35.0,31.0,70.9 --name "Kdo pije víno" \
 *     --out apps/web/public/layers/wine-map.pmtiles
 *
 * `--bbox` is west,south,east,north. The web layer consumes the archive through the existing
 * `pmtiles://` protocol with `bounds` set to the same bbox.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const input = arg("input");
const bbox = arg("bbox");
const out = resolve(repo, arg("out"));
const name = arg("name") ?? "Raster image";
const attribution = arg("attribution") ?? "";
const minZoom = Number(arg("min-zoom", "0"));
const maxZoom = Number(arg("max-zoom", "10"));
const tileSize = Number(arg("tile-size", "256"));
const format = arg("format", "png");

if (!input || !bbox || !out || !Number.isFinite(minZoom) || !Number.isFinite(maxZoom)) {
  console.error(
    "Usage: node scripts/tile-raster-image.mjs --input image.png --bbox w,s,e,n --out apps/web/public/layers/id.pmtiles"
  );
  process.exit(1);
}

const values = bbox.split(",").map(Number);
if (values.length !== 4 || !values.every(Number.isFinite)) {
  console.error(`--bbox must be west,south,east,north (got "${bbox}")`);
  process.exit(1);
}
const [west, south, east, north] = values;
if (west >= east || south >= north) {
  console.error(`--bbox must have west < east and south < north (got "${bbox}")`);
  process.exit(1);
}

const { default: sharp } = await import("sharp");
// The reader (MapLibre's pmtiles protocol) uses the npm package's own tile-id curve; reuse its
// pure function instead of re-deriving it. The package stays read-only — this is just math.
const { zxyToTileId } = await import("pmtiles");

// ── Mercator geometry ─────────────────────────────────────────────────────────────

function lonToWorld(lng, zoom) {
  return ((lng + 180) / 360) * tileSize * 2 ** zoom;
}

function latToWorld(lat, zoom) {
  const clamped = Math.min(85.051129, Math.max(-85.051129, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * tileSize * 2 ** zoom;
}

/** The bbox in world pixels at a zoom, and the tile range it covers. */
function bboxTiles(zoom) {
  const x0 = lonToWorld(west, zoom);
  const x1 = lonToWorld(east, zoom);
  const y0 = latToWorld(north, zoom);
  const y1 = latToWorld(south, zoom);
  const tx0 = Math.max(0, Math.floor(x0 / tileSize));
  const ty0 = Math.max(0, Math.floor(y0 / tileSize));
  const tx1 = Math.min(2 ** zoom - 1, Math.floor((x1 - 1e-9) / tileSize));
  const ty1 = Math.min(2 ** zoom - 1, Math.floor((y1 - 1e-9) / tileSize));
  return { x0, x1, y0, y1, tx0, ty0, tx1, ty1 };
}

// ── PMTiles v3 writer ─────────────────────────────────────────────────────────────

function varint(value) {
  const bytes = [];
  let v = Math.max(0, Math.trunc(value));
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 0x80);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

/** Global tile id: the npm package's curve (used by the reader), kept as a thin wrapper. */
function tileId(z, x, y) {
  return zxyToTileId(z, x, y);
}

function e7(value) {
  const v = Math.round(value * 1e7);
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(v, 0);
  return buffer;
}

/**
 * One directory of (tileId -> offset/length) entries, in the reader's wire shape:
 * entry count, delta-encoded tile ids, run lengths, byte lengths, offsets relative to the tile
 * data section (stored value+1; 0 would mean "continues the previous tile"). The minimal writer
 * uses run_length 1 everywhere (no deduplication), which is the honest shape for a unique raster.
 */
function encodeDirectory(entries) {
  const sorted = [...entries].sort((a, b) => a.tileId - b.tileId);
  const parts = [varint(sorted.length)];
  let previousId = 0;
  for (const entry of sorted) {
    parts.push(varint(entry.tileId - previousId));
    previousId = entry.tileId;
  }
  for (let i = 0; i < sorted.length; i++) parts.push(varint(1));
  for (const entry of sorted) parts.push(varint(entry.length));
  for (const entry of sorted) parts.push(varint(entry.offset + 1));
  return Buffer.concat(parts);
}

function buildHeader({
  rootOffset,
  rootLength,
  metadataOffset,
  metadataLength,
  dataOffset,
  dataLength,
  tileCount,
  bounds,
  centerZoom
}) {
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header.writeUInt8(3, 7); // spec version
  header.writeBigUInt64LE(BigInt(rootOffset), 8);
  header.writeBigUInt64LE(BigInt(rootLength), 16);
  header.writeBigUInt64LE(BigInt(metadataOffset), 24);
  header.writeBigUInt64LE(BigInt(metadataLength), 32);
  header.writeBigUInt64LE(BigInt(0), 40); // leaf directories
  header.writeBigUInt64LE(BigInt(0), 48);
  header.writeBigUInt64LE(BigInt(dataOffset), 56);
  header.writeBigUInt64LE(BigInt(dataLength), 64);
  header.writeBigUInt64LE(BigInt(tileCount), 72);
  header.writeBigUInt64LE(BigInt(tileCount), 80);
  header.writeBigUInt64LE(BigInt(tileCount), 88);
  header.writeUInt8(0, 96); // not clustered
  header.writeUInt8(0, 97); // no internal compression
  header.writeUInt8(0, 98); // no tile compression (png/jpeg are compressed already)
  header.writeUInt8({ png: 2, jpeg: 3, webp: 4 }[format] ?? 2, 99);
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  e7(bounds.west).copy(header, 102);
  e7(bounds.south).copy(header, 106);
  e7(bounds.east).copy(header, 110);
  e7(bounds.north).copy(header, 114);
  header.writeUInt8(centerZoom, 118);
  e7((bounds.west + bounds.east) / 2).copy(header, 119);
  e7((bounds.south + bounds.north) / 2).copy(header, 123);
  return header;
}

// ── Tile rendering ────────────────────────────────────────────────────────────────

const source = sharp(input);
const metadata = await source.metadata();
const imageWidth = metadata.width;
const imageHeight = metadata.height;
if (!imageWidth || !imageHeight) {
  console.error(`Cannot read dimensions of "${input}".`);
  process.exit(1);
}
console.log(`Source ${input}: ${imageWidth}x${imageHeight}, bbox ${bbox}`);
console.log(`Zooms ${minZoom}-${maxZoom}, ${format} -> ${out}`);
mkdirSync(dirname(out), { recursive: true });

const tiles = []; // { z, x, y, buffer }

for (let z = minZoom; z <= maxZoom; z += 1) {
  const { x0, x1, y0, y1, tx0, ty0, tx1, ty1 } = bboxTiles(z);
  const worldW = x1 - x0;
  const worldH = y1 - y0;
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      // The tile's world-pixel rect mapped into the source image.
      const u0 = ((tx * tileSize - x0) / worldW) * imageWidth;
      const u1 = (((tx + 1) * tileSize - x0) / worldW) * imageWidth;
      const v0 = ((ty * tileSize - y0) / worldH) * imageHeight;
      const v1 = (((ty + 1) * tileSize - y0) / worldH) * imageHeight;
      const left = Math.floor(u0);
      const top = Math.floor(v0);
      const width = Math.ceil(u1) - left;
      const height = Math.ceil(v1) - top;
      if (width <= 0 || height <= 0 || left >= imageWidth || top >= imageHeight) continue;

      const buffer = await source
        .clone()
        .extract({
          left: Math.max(0, left),
          top: Math.max(0, top),
          width: Math.min(width, imageWidth - Math.max(0, left)),
          height: Math.min(height, imageHeight - Math.max(0, top))
        })
        .resize(tileSize, tileSize, { fit: "fill", kernel: "lanczos3" })
        .toFormat(format)
        .toBuffer();
      tiles.push({ z, x: tx, y: ty, buffer });
    }
  }
  console.log(`  z${z}: ${tiles.length - tiles.filter((t) => t.z < z).length} tiles`);
}

if (!tiles.length) {
  console.error("No tiles produced — is the bbox inside the image?");
  process.exit(1);
}

// ── Archive assembly ──────────────────────────────────────────────────────────────

const rootOffset = 127;
const metadataJson = JSON.stringify({
  name,
  ...(attribution ? { attribution } : {}),
  description: "Raster image tiled by scripts/tile-raster-image.mjs",
  type: "overlay",
  minZoom,
  maxZoom,
  bounds: `${west},${south},${east},${north}`
});

// Directory entries carry tile offsets relative to the data section. Their varint length can
// still shift the section start, so resolve the cycle to a fixed point (one iteration is
// enough in practice; loop until stable to be exact).
const tileIds = tiles.map((tile) => tileId(tile.z, tile.x, tile.y));
let dataOffset = 0;
let rootDirFinal;
let finalEntries = [];
for (let pass = 0; pass < 8; pass += 1) {
  const candidate =
    rootOffset + encodeDirectory(finalEntries).length + Buffer.byteLength(metadataJson);
  let cursor = 0;
  finalEntries = tiles.map((tile, index) => {
    const entry = { tileId: tileIds[index], length: tile.buffer.length, offset: cursor };
    cursor += tile.buffer.length;
    return entry;
  });
  if (candidate === dataOffset) break;
  dataOffset = candidate;
}

const metadataOffset = rootOffset + encodeDirectory(finalEntries).length;
rootDirFinal = encodeDirectory(finalEntries);
const dataLength = finalEntries.reduce((sum, entry) => sum + entry.length, 0);

const header = buildHeader({
  rootOffset,
  rootLength: rootDirFinal.length,
  metadataOffset,
  metadataLength: Buffer.byteLength(metadataJson),
  dataOffset,
  dataLength,
  tileCount: tiles.length,
  bounds: { west, south, east, north },
  centerZoom: minZoom
});

const archive = Buffer.concat([
  header,
  rootDirFinal,
  Buffer.from(metadataJson),
  ...tiles.map((tile) => tile.buffer)
]);
writeFileSync(out, archive);
console.log(`Wrote ${out}: ${tiles.length} tiles, ${(archive.length / 1024 / 1024).toFixed(1)} MB`);
