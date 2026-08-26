/** Paints a numeric weather grid into a MapLibre canvas source using our own colour ramps.
 *
 *  Drawing the field ourselves — rather than layering someone else's pre-coloured PNG tiles — is
 *  what makes the vivid Windy-style look possible, and it costs one small canvas instead of a
 *  tile pyramid.
 */

import type maplibregl from "maplibre-gl";
import { latToMercatorY, mercatorYToLat, sampleGrid, type WeatherGrid } from "./grid";
import { paletteFor, sampleRamp } from "./palettes";

/** The grid itself is coarse (about 11×9 samples), so a modest canvas already exceeds the real
 *  information content; the GPU smooths the rest when it stretches the quad. */
const CANVAS_W = 320;
const CANVAS_H = 320;

export interface GridOverlay {
  render(grid: WeatherGrid): void;
  clear(): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  detach(): void;
}

export function createGridOverlay(
  map: maplibregl.Map,
  layerId: string,
  options: { beforeId?: string } = {}
): GridOverlay {
  const sourceId = `source-${layerId}-grid`;
  const rasterLayerId = `raster-${layerId}-grid`;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let visible = true;
  let opacity = 0.75;
  let attached = false;

  function paint(grid: WeatherGrid) {
    if (!ctx) return;
    const palette = paletteFor(grid.variable);
    const [w, s, e, n] = grid.bbox;
    // MapLibre stretches the canvas linearly in Web Mercator, so each output row must be sampled
    // at the latitude that row actually lands on — otherwise the field slides north/south.
    const yTop = latToMercatorY(n);
    const yBottom = latToMercatorY(s);

    const image = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = image.data;

    for (let py = 0; py < CANVAS_H; py += 1) {
      const lat = mercatorYToLat(yTop + ((yBottom - yTop) * (py + 0.5)) / CANVAS_H);
      for (let px = 0; px < CANVAS_W; px += 1) {
        const lng = w + ((e - w) * (px + 0.5)) / CANVAS_W;
        const value = sampleGrid(grid, grid.values, lng, lat);
        const offset = (py * CANVAS_W + px) * 4;
        if (value === null) {
          data[offset + 3] = 0;
          continue;
        }
        const [r, g, b, a] = sampleRamp(palette, value);
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function ensureLayer(bbox: [number, number, number, number]) {
    const [w, s, e, n] = bbox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [w, n],
      [e, n],
      [e, s],
      [w, s]
    ];

    const existing = map.getSource(sourceId) as maplibregl.CanvasSource | undefined;
    if (existing) {
      existing.setCoordinates(coordinates);
      return;
    }

    map.addSource(sourceId, { type: "canvas", canvas, coordinates, animate: false });
    map.addLayer(
      {
        id: rasterLayerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": opacity,
          "raster-fade-duration": 200,
          "raster-resampling": "linear"
        },
        layout: { visibility: visible ? "visible" : "none" }
      },
      options.beforeId && map.getLayer(options.beforeId) ? options.beforeId : undefined
    );
    attached = true;
  }

  return {
    render(grid) {
      paint(grid);
      ensureLayer(grid.bbox);
      const source = map.getSource(sourceId) as maplibregl.CanvasSource | undefined;
      // A non-animated canvas source only re-uploads when told to.
      source?.play?.();
      source?.pause?.();
    },
    clear() {
      if (map.getLayer(rasterLayerId)) map.removeLayer(rasterLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      attached = false;
    },
    setVisible(next) {
      visible = next;
      if (attached && map.getLayer(rasterLayerId)) {
        map.setLayoutProperty(rasterLayerId, "visibility", next ? "visible" : "none");
      }
    },
    setOpacity(next) {
      opacity = next;
      if (attached && map.getLayer(rasterLayerId)) {
        map.setPaintProperty(rasterLayerId, "raster-opacity", next);
      }
    },
    detach() {
      this.clear();
    }
  };
}
