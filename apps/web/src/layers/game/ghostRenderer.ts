import * as THREE from "three";
import { fetchAavegotchiSvg } from "./aavegotchi/aavegotchiContractClient";

/** Public, no-auth-required subgraph documented at
 * https://docs.aavegotchi.com/developers/subgraphs/svg-subgraph — returns ready-to-render
 * Aavegotchi SVG markup by token id. If it's ever unreachable (hosted subgraphs are being
 * phased out across The Graph's ecosystem) we fall back to a drawn ghost glyph so the layer
 * stays fully playable either way. */
const SUBGRAPH_URL = "https://api.thegraph.com/subgraphs/name/aavegotchi/aavegotchi-svg";
const SPRITE_SIZE = 128;

const svgCache = new Map<string, Promise<string | null>>();

async function fetchGotchiSvg(tokenId: string): Promise<string | null> {
  const cached = svgCache.get(tokenId);
  if (cached) return cached;
  const promise = (async () => {
    const fromContract = await fetchAavegotchiSvg(tokenId);
    if (fromContract) return fromContract;
    try {
      const res = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `{ aavegotchi(id: "${tokenId}") { svg } }` }),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { data?: { aavegotchi?: { svg?: string } } };
      return data.data?.aavegotchi?.svg ?? null;
    } catch {
      return null;
    }
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

async function svgMarkupToCanvas(svgMarkup: string, size: number): Promise<HTMLCanvasElement> {
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
    drawFallbackGhost(ctx, size);
  }
  return canvas;
}

/** Builds a billboard sprite for a ghost, textured with its real Aavegotchi artwork when the
 * subgraph is reachable, otherwise a drawn placeholder ghost. */
export async function createGhostSprite(gotchiId: string): Promise<THREE.Sprite> {
  const svg = await fetchGotchiSvg(gotchiId);
  const canvas = svg
    ? await svgMarkupToCanvas(svg, SPRITE_SIZE)
    : (() => {
        const c = document.createElement("canvas");
        c.width = SPRITE_SIZE;
        c.height = SPRITE_SIZE;
        drawFallbackGhost(c.getContext("2d")!, SPRITE_SIZE);
        return c;
      })();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 6, 1);
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
