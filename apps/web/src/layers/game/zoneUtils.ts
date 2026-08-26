/** Deterministic per-id RNG so the same zone always spawns the same props on every
 * client and every reload (ported from the original QuestLayer zoneGeometry.ts). */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METERS_PER_DEG_LAT = 111_320;

export function metersToLngLatOffset(
  dxMeters: number,
  dyMeters: number,
  atLat: number
): { dLng: number; dLat: number } {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180);
  return { dLng: dxMeters / Math.max(metersPerDegLng, 1), dLat: dyMeters / METERS_PER_DEG_LAT };
}
