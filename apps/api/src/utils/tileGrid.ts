import type { Bbox } from "@mapos/layer-sdk";

/** Slippy-map tile helpers used to break a viewport bbox into cacheable z9 cells
 * (~ 75km × 75km at the equator, a few tens of km over Central Europe — smaller Overpass
 * requests that complete more reliably than the previous z7 cells). */
export const CELL_ZOOM = 9;

export interface Cell {
  z: number;
  x: number;
  y: number;
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function cellId(cell: Cell): string {
  return `${cell.z}/${cell.x}/${cell.y}`;
}

export function cellBounds(cell: Cell): Bbox {
  const west = tileXToLon(cell.x, cell.z);
  const east = tileXToLon(cell.x + 1, cell.z);
  const north = tileYToLat(cell.y, cell.z);
  const south = tileYToLat(cell.y + 1, cell.z);
  return [west, south, east, north];
}

/** All cells at the given zoom intersecting the bbox, capped to a sane amount so an
 * accidental world-sized viewport can't trigger thousands of upstream calls. */
export function cellsForBbox(bbox: Bbox, maxCells = 24, zoom = CELL_ZOOM): Cell[] {
  const [w, s, e, n] = bbox;
  const clampedLat = (lat: number) => Math.max(-85, Math.min(85, lat));
  const minX = lonToTileX(w, zoom);
  const maxX = lonToTileX(e, zoom);
  const minY = latToTileY(clampedLat(n), zoom);
  const maxY = latToTileY(clampedLat(s), zoom);

  const cells: Cell[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      cells.push({ z: zoom, x, y });
      if (cells.length >= maxCells) return cells;
    }
  }
  return cells;
}
