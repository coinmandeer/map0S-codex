import type maplibregl from "maplibre-gl";
import { distanceMeters } from "@mapos/layer-sdk";

export interface GameOrb {
  id: string;
  lng: number;
  lat: number;
}

const ORB_SPACING_M = 25;
const ORB_RADIUS_M = 200;
const COLLECTED_KEY = "mapos:orbs:collected";
const XP_KEY = "mapos:orbs:xp";

export function loadCollectedOrbIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLECTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function persistCollectedOrbIds(ids: Set<string>) {
  localStorage.setItem(COLLECTED_KEY, JSON.stringify([...ids].slice(-4000)));
}

export function loadOrbXp(): number {
  const n = Number(localStorage.getItem(XP_KEY) ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export function addOrbXp(delta: number): number {
  const next = loadOrbXp() + delta;
  localStorage.setItem(XP_KEY, String(next));
  return next;
}

function hashId(lng: number, lat: number): string {
  return `orb:${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function sampleLine(
  coords: Array<[number, number]>,
  spacingM: number,
  origin: { lng: number; lat: number }
): GameOrb[] {
  const out: GameOrb[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const len = distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (len < 2) continue;
    const steps = Math.max(1, Math.floor(len / spacingM));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const lng = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      if (distanceMeters(origin, { lng, lat }) > ORB_RADIUS_M) continue;
      out.push({ id: hashId(lng, lat), lng, lat });
    }
  }
  return out;
}

function radialFallback(origin: { lng: number; lat: number }, collected: Set<string>): GameOrb[] {
  const orbs: GameOrb[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const dist = 40 + (i % 4) * 28;
    const dLat = (dist * Math.cos(angle)) / 111_320;
    const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
    const lng = origin.lng + dLng;
    const lat = origin.lat + dLat;
    const id = hashId(lng, lat);
    if (!collected.has(id)) orbs.push({ id, lng, lat });
  }
  return orbs;
}

export function generateStreetOrbs(
  map: maplibregl.Map,
  origin: { lng: number; lat: number },
  collected: Set<string>
): GameOrb[] {
  let features: maplibregl.MapGeoJSONFeature[];
  try {
    features = map.queryRenderedFeatures();
  } catch {
    features = [];
  }
  const seen = new Set<string>();
  const orbs: GameOrb[] = [];
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    const lines: Array<Array<[number, number]>> = [];
    if (geom.type === "LineString") lines.push(geom.coordinates as Array<[number, number]>);
    if (geom.type === "MultiLineString")
      lines.push(...(geom.coordinates as Array<Array<[number, number]>>));
    for (const line of lines) {
      for (const orb of sampleLine(line, ORB_SPACING_M, origin)) {
        if (collected.has(orb.id) || seen.has(orb.id)) continue;
        seen.add(orb.id);
        orbs.push(orb);
        if (orbs.length >= 80) return orbs;
      }
    }
  }
  return orbs.length ? orbs : radialFallback(origin, collected);
}
