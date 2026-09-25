import type maplibregl from "maplibre-gl";
import { PIN_STYLES } from "../ui/presets";
import { glyphPath } from "./materialIcons";

const WIDTH = 72;
const HEIGHT = 72;

/** Circular POI badge; no tail, the centre is the actual geographic point. */
function drawPinCanvas(color: string, categoryId: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const cx = WIDTH / 2;
  const headR = WIDTH * 0.44;
  const cy = HEIGHT / 2;
  ctx.save();
  ctx.shadowColor = "rgba(15, 15, 15, 0.4)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, headR - 1.5, 0, Math.PI * 2);
  ctx.stroke();

  const pathData = glyphPath(categoryId);
  const shape = new Path2D(pathData);
  const iconScale = (headR * 1.15 * 0.55) / 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(iconScale, iconScale);
  ctx.translate(-12, -12);
  ctx.fillStyle = "#ffffff";
  ctx.fill(shape);
  ctx.restore();

  return canvas;
}

function registerPinImage(map: maplibregl.Map, imageId: string, color: string, categoryId: string) {
  const canvas = drawPinCanvas(color, categoryId);
  const imageData = canvas.getContext("2d")!.getImageData(0, 0, WIDTH, HEIGHT);
  if (map.hasImage(imageId)) map.removeImage(imageId);
  map.addImage(imageId, imageData, { pixelRatio: 2 });
}

export function ensurePinImages(map: maplibregl.Map) {
  for (const [id, style] of Object.entries(PIN_STYLES)) {
    const imageId = `pin-${id}`;
    if (!map.hasImage(imageId)) registerPinImage(map, imageId, style.color, id);
  }
  if (!map.hasImage("pin-default")) registerPinImage(map, "pin-default", "#B7791F", "default");
}

export function pinImageId(category: string | undefined): string {
  if (category && PIN_STYLES[category]) return `pin-${category}`;
  return "pin-default";
}

export const LAYER_GLYPHS: Record<string, string> = {
  "charging-stations": "charging",
  "commons-photos": "webcam",
  earthquakes: "earthquake",
  events: "event",
  "air-quality": "air",
  "active-fires": "fire",
  inaturalist: "leaf",
  webcams: "webcam",
  panoramax: "webcam",
  mapillary: "webcam",
  satellites: "satellite",
  "temporary-messages": "message",
  gbif: "leaf",
  openaq: "air"
};

/** A data layer (earthquakes, observations, events, …) gets a single, layer-coloured pin badge.
 *  It is keyed by the layer id so `createDataLayer` can reference `pin-<id>` without adding a
 *  PIN_STYLES entry per external source. The glyph is a layer-specific Material icon when known
 *  (webcams, earthquakes…), otherwise the generic pin shape. */
export function ensureDataPinImage(
  map: maplibregl.Map,
  id: string,
  color: string,
  category?: string
) {
  const imageId = `pin-${id}`;
  const glyph = category ?? LAYER_GLYPHS[id] ?? "default";
  if (!map.hasImage(imageId)) registerPinImage(map, imageId, color, glyph);
}
