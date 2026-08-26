import type maplibregl from "maplibre-gl";
import { PIN_STYLES } from "../ui/presets";
import { MATERIAL_ICON_PATHS } from "./materialIcons";

const WIDTH = 72;
const HEIGHT = 96;

/** Teardrop pin: coloured circular head + smaller glyph + white triangular tip at the bottom. */
function drawPinCanvas(color: string, categoryId: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const cx = WIDTH / 2;
  const headR = WIDTH * 0.36;
  const cy = 8 + headR;
  const tipY = HEIGHT - 4;

  ctx.save();
  ctx.shadowColor = "rgba(15, 15, 15, 0.4)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx - 9, cy + headR * 0.45);
  ctx.lineTo(cx + 9, cy + headR * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

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

  const pathData = MATERIAL_ICON_PATHS[categoryId] ?? MATERIAL_ICON_PATHS.default!;
  const icon = new Path2D(pathData);
  const iconScale = (headR * 1.15 * 0.55) / 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(iconScale, iconScale);
  ctx.translate(-12, -12);
  ctx.fillStyle = "#ffffff";
  ctx.fill(icon);
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
