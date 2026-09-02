import * as THREE from "three";
import { fetchAavegotchiSvg } from "./aavegotchi/aavegotchiContractClient";

/** The SVG is read directly from the public Base contract. The legacy hosted subgraph now
 * redirects its POST preflight and is blocked by browser CORS, so calling it only produced a
 * console error before falling back. A local drawn sprite keeps the game playable offline. */
const SPRITE_SIZE = 128;

const svgCache = new Map<string, Promise<string | null>>();

async function fetchGotchiSvg(tokenId: string): Promise<string | null> {
  const cached = svgCache.get(tokenId);
  if (cached) return cached;
  const promise = (async () => {
    const fromContract = await fetchAavegotchiSvg(tokenId);
    if (fromContract) return fromContract;
    return null;
  })();
  svgCache.set(tokenId, promise);
  return promise;
}

function drawFallbackGhost(ctx: CanvasRenderingContext2D, size: number) {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const top = size * 0.16;
  const r = size * 0.32;
  const bottom = size * 0.86;

  ctx.fillStyle = "#A78BFA";
  ctx.beginPath();
  ctx.moveTo(cx - r, bottom);
  ctx.lineTo(cx - r, top + r);
  ctx.arc(cx, top + r, r, Math.PI, 0);
  ctx.lineTo(cx + r, bottom);
  const waves = 4;
  for (let i = 0; i < waves; i++) {
    const x0 = cx + r - i * ((2 * r) / waves);
    const x1 = x0 - r / waves;
    ctx.quadraticCurveTo(
      x0 - r / (waves * 2),
      bottom + (i % 2 === 0 ? r * 0.14 : -r * 0.06),
      x1,
      bottom
    );
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1C1917";
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, top + r * 0.95, r * 0.13, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.35, top + r * 0.95, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

function drawFallbackAvatar(ctx: CanvasRenderingContext2D, size: number) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  const unit = size / 16;

  // A self-contained Gotchi silhouette, used immediately and whenever no real token was entered.
  // The previous teal rectangle read as a generic robot. White ghost body, purple eye sockets,
  // side hands, antenna gem and split pixel feet make this recognisable as an Aavegotchi even at
  // map scale, while remaining clearly different from the floating enemy ghost.
  const block = (colour: string, x: number, y: number, width: number, height: number) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x * unit, y * unit, width * unit, height * unit);
  };
  const outline = "#34205C";
  const cloth = "#FFF9FF";
  const shade = "#D8C8F2";
  const purple = "#7C3AED";
  const ink = "#171124";

  // Shadow plus chunky outer silhouette.
  block("rgba(23,17,36,0.22)", 4, 14, 8, 1);
  block(outline, 7, 0, 2, 3);
  block(outline, 5, 2, 6, 1);
  block(outline, 3, 3, 10, 10);
  block(outline, 2, 5, 1, 7);
  block(outline, 13, 5, 1, 7);
  block(outline, 1, 7, 2, 3);
  block(outline, 14, 7, 1, 3);
  block(outline, 4, 12, 3, 3);
  block(outline, 9, 12, 3, 3);

  // Cloth/body and its lavender lower fold.
  block(cloth, 5, 3, 6, 1);
  block(cloth, 4, 4, 8, 7);
  block(cloth, 3, 6, 10, 4);
  block(shade, 4, 10, 8, 2);
  block(cloth, 5, 12, 2, 2);
  block(cloth, 9, 12, 2, 2);

  // Antenna jewel and gloved side hands.
  block("#F8B84E", 7, 0, 2, 1);
  block(purple, 7, 1, 2, 2);
  block(purple, 1, 7, 2, 2);
  block(purple, 13, 7, 2, 2);
  block("#B89AE8", 2, 9, 1, 1);
  block("#B89AE8", 13, 9, 1, 1);

  // Large violet eye sockets, black pupils, cheeks and tiny spirit rune.
  block(purple, 4, 5, 3, 3);
  block(purple, 9, 5, 3, 3);
  block(ink, 5, 6, 1, 1);
  block(ink, 10, 6, 1, 1);
  block("#F4A6C8", 3, 8, 2, 1);
  block("#F4A6C8", 11, 8, 2, 1);
  block(ink, 7, 8, 2, 1);
  block("#F8B84E", 7, 10, 2, 1);
}

function fallbackCanvas(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  draw(canvas.getContext("2d")!, SPRITE_SIZE);
  return canvas;
}

async function createGotchiSprite(
  gotchiId: string,
  fallback: (ctx: CanvasRenderingContext2D, size: number) => void
): Promise<THREE.Sprite> {
  const svg = await fetchGotchiSvg(gotchiId);
  const canvas = svg
    ? await svgMarkupToCanvas(svg, SPRITE_SIZE, fallback)
    : fallbackCanvas(fallback);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}

function createCanvasSprite(canvas: HTMLCanvasElement): THREE.Sprite {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}

async function svgMarkupToCanvas(
  svgMarkup: string,
  size: number,
  fallback: (ctx: CanvasRenderingContext2D, size: number) => void
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  try {
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("SVG decode failed"));
        img.src = url;
      });
      ctx.drawImage(img, 0, 0, size, size);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    fallback(ctx, size);
  }
  return canvas;
}

/** Builds a billboard sprite for a ghost, textured with contract artwork when available. */
export async function createGhostSprite(gotchiId: string): Promise<THREE.Sprite> {
  const sprite = await createGotchiSprite(gotchiId, drawFallbackGhost);
  sprite.scale.set(6, 6, 1);
  return sprite;
}

/** Player avatar: real contract SVG when available, bright grounded fallback otherwise. */
export async function createAvatarSprite(gotchiId: string): Promise<THREE.Sprite> {
  const sprite = await createGotchiSprite(gotchiId, drawFallbackAvatar);
  sprite.material.depthTest = false;
  sprite.renderOrder = 1_000;
  sprite.scale.set(18, 18, 1);
  return sprite;
}

/** Immediate player art: entering game never waits for RPC, SVG decoding or a third-party host. */
export function createLocalAvatarSprite(): THREE.Sprite {
  const sprite = createCanvasSprite(fallbackCanvas(drawFallbackAvatar));
  // Player art must stay readable over zone props and buildings. It is a map avatar, not a world
  // object that should disappear behind the crystal generated at the same quest coordinate.
  sprite.material.depthTest = false;
  sprite.renderOrder = 1_000;
  sprite.scale.set(18, 18, 1);
  return sprite;
}

export function createPlaceholderGhostSprite(): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    color: 0xa78bfa,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 6, 1);
  return sprite;
}

/** Gotchi/ghost sprites own their canvas texture and material. Three.js does not release either
 * when an Object3D is removed from a scene, so mode switches must dispose them explicitly. */
export function disposeSprite(sprite: THREE.Sprite) {
  const material = sprite.material;
  material.map?.dispose();
  material.dispose();
}
