/**
 * PNG app icons from the SVG masters.
 *
 * iOS ignores SVG for `apple-touch-icon` and falls back to a screenshot of the page, and Android
 * install prompts want raster sizes in the manifest. Run after changing `public/icon*.svg`:
 *   node scripts/render-app-icons.mjs
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../apps/web/public/", import.meta.url));
const targets = [
  // iOS home screen: opaque, no transparency (iOS fills transparent pixels with black).
  { source: "icon-maskable.svg", file: "apple-touch-icon.png", size: 180 },
  { source: "icon.svg", file: "icon-192.png", size: 192 },
  { source: "icon.svg", file: "icon-512.png", size: 512 },
  { source: "icon-maskable.svg", file: "icon-maskable-512.png", size: 512 }
];

for (const { source, file, size } of targets) {
  await sharp(`${publicDir}${source}`, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${publicDir}${file}`);
  console.log(`${file} ${size}×${size}`);
}
