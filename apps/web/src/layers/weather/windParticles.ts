/** Animated wind-flow overlay — the streaming filaments that make a weather map feel alive.
 *
 *  Particles live in screen space and are advected by the wind grid: each frame a particle is
 *  unprojected to a coordinate, sampled against the grid's u/v components, moved, and drawn as a
 *  short segment. Trails come from fading the previous frame instead of clearing it, so a handful
 *  of thousand-pixel lines reads as continuous flow.
 *
 *  It draws to its own 2D canvas above the map rather than a GL layer: no shader plumbing, and it
 *  degrades to a still image under `prefers-reduced-motion`.
 */

import type maplibregl from "maplibre-gl";
import { sampleGrid, type WeatherGrid } from "./grid";

const PARTICLE_DENSITY = 1 / 2200; // particles per CSS pixel of map area
const MAX_PARTICLES = 2200;
const MIN_PARTICLES = 220;
/** Particle lifetime in frames; respawning keeps trails from collapsing into stagnation points. */
const MAX_AGE = 90;
/** Screen pixels travelled per second at 1 m/s of wind, at the reference zoom. Tuned by eye:
 *  fast enough to read direction instantly, slow enough not to strobe. */
const SPEED_SCALE = 2.6;
const TRAIL_FADE = 0.92;

interface Particle {
  x: number;
  y: number;
  age: number;
}

export interface WindParticleOverlay {
  setGrid(grid: WeatherGrid | null): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  detach(): void;
}

export function createWindParticles(map: maplibregl.Map): WindParticleOverlay {
  const container = map.getCanvasContainer();
  const canvas = document.createElement("canvas");
  canvas.className = "wind-particles";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let particles: Particle[] = [];
  let grid: WeatherGrid | null = null;
  let visible = true;
  let opacity = 0.9;
  let frameId = 0;
  let width = 0;
  let height = 0;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function resize() {
    const rect = map.getCanvas().getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const count = Math.round(
      Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, width * height * PARTICLE_DENSITY))
    );
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      age: Math.floor(Math.random() * MAX_AGE)
    }));
  }

  function respawn(p: Particle) {
    p.x = Math.random() * width;
    p.y = Math.random() * height;
    p.age = 0;
  }

  /** Wind at a screen position, converted from m/s into screen pixels per frame. Doing the
   *  conversion through two projected points keeps the speed correct at any zoom or latitude. */
  function velocityAt(x: number, y: number): { dx: number; dy: number; speed: number } | null {
    if (!grid?.u || !grid.v) return null;
    const at = map.unproject([x, y]);
    const u = sampleGrid(grid, grid.u, at.lng, at.lat);
    const v = sampleGrid(grid, grid.v, at.lng, at.lat);
    if (u === null || v === null) return null;

    // One degree of longitude/latitude in screen pixels, measured locally.
    const east = map.project([at.lng + 0.01, at.lat]);
    const north = map.project([at.lng, at.lat + 0.01]);
    const origin = map.project([at.lng, at.lat]);
    const metersPerDegLat = 111_320;
    const metersPerDegLng = metersPerDegLat * Math.max(0.1, Math.cos((at.lat * Math.PI) / 180));
    // Use both projected axes so direction remains correct on rotated maps. Normalize the
    // display speed: geographically literal motion is invisible at a continental zoom.
    const dx =
      (u / metersPerDegLng) * (east.x - origin.x) + (v / metersPerDegLat) * (north.x - origin.x);
    const dy =
      (u / metersPerDegLng) * (east.y - origin.y) + (v / metersPerDegLat) * (north.y - origin.y);
    const length = Math.hypot(dx, dy);
    const speed = Math.hypot(u, v);
    const step = Math.min(80, speed * SPEED_SCALE) / 60;
    return { dx: length ? (dx / length) * step : 0, dy: length ? (dy / length) * step : 0, speed };
  }

  function strokeFor(speed: number): string {
    // Brighter and warmer as it gets windier, matching the wind ramp without importing it —
    // these are highlights over the coloured field, not the field itself.
    if (speed > 22) return "rgba(255, 236, 200, 0.95)";
    if (speed > 14) return "rgba(255, 248, 232, 0.85)";
    if (speed > 7) return "rgba(232, 248, 255, 0.75)";
    return "rgba(206, 232, 250, 0.6)";
  }

  function drawFrame() {
    if (!ctx || !visible || !grid) return;

    // Fading instead of clearing is what leaves the trails behind each particle.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - TRAIL_FADE})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";

    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    for (const p of particles) {
      const velocity = velocityAt(p.x, p.y);
      if (!velocity) {
        respawn(p);
        continue;
      }
      const nextX = p.x + velocity.dx;
      const nextY = p.y + velocity.dy; // project() already returns screen-space direction

      if (p.age < MAX_AGE && nextX >= 0 && nextX <= width && nextY >= 0 && nextY <= height) {
        ctx.strokeStyle = strokeFor(velocity.speed);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();
        p.x = nextX;
        p.y = nextY;
        p.age += 1;
      } else {
        respawn(p);
      }
    }
  }

  function loop() {
    drawFrame();
    frameId = window.requestAnimationFrame(loop);
  }

  function clearCanvas() {
    ctx?.clearRect(0, 0, width, height);
  }

  function start() {
    if (frameId || !visible || !grid) return;
    if (reduceMotion) {
      // A single frame still shows direction; it just doesn't move.
      drawFrame();
      return;
    }
    frameId = window.requestAnimationFrame(loop);
  }

  function stop() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  }

  // Panning and zooming invalidate every screen-space position at once, so start over rather
  // than dragging smeared trails across the viewport.
  const onMove = () => clearCanvas();
  map.on("move", onMove);
  map.on("resize", resize);
  resize();

  return {
    setGrid(next) {
      grid = next;
      clearCanvas();
      if (!next) stop();
      else start();
    },
    setVisible(next) {
      visible = next;
      canvas.style.display = next ? "" : "none";
      if (!next) {
        stop();
        clearCanvas();
      } else {
        start();
      }
    },
    setOpacity(next) {
      opacity = next;
      canvas.style.opacity = String(opacity);
    },
    detach() {
      stop();
      map.off("move", onMove);
      map.off("resize", resize);
      canvas.remove();
    }
  };
}
