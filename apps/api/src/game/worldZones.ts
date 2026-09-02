import type { Bbox } from "@mapos/layer-sdk";
import type { AnchoredQuest } from "./anchors.js";

export type WorldZoneKind = "standard" | "event" | "staker_gate";
export type WorldZoneLifecycle = "active" | "scheduled" | "expired";
export type WorldZoneSize = "S" | "M" | "L" | "XL";

export interface CuratedZoneInput {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  description?: string | null;
  category?: string | null;
  lootTier?: string | null;
  zoneKind?: string | null;
  minStakeUsd?: number | null;
  activeFrom?: Date | string | null;
  activeUntil?: Date | string | null;
}

export interface WorldZone {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  description: string | null;
  category: string | null;
  lootTier: string;
  zoneKind: WorldZoneKind;
  minStakeUsd: number;
  activeFrom: string | null;
  activeUntil: string | null;
  isTemporary: boolean;
  lifecycle: WorldZoneLifecycle;
  isLive: boolean;
  startsInSeconds: number | null;
  endsInSeconds: number | null;
  sizeTier: WorldZoneSize;
  eventTag: string | null;
}

const KIND_ORDER: WorldZoneKind[] = ["standard", "event", "staker_gate"];
const HOUR_MS = 60 * 60 * 1000;

function dateValue(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function kindOf(value: string | null | undefined): WorldZoneKind {
  return value === "event" || value === "staker_gate" ? value : "standard";
}

function sizeFor(radiusM: number): WorldZoneSize {
  if (radiusM >= 400) return "XL";
  if (radiusM >= 250) return "L";
  if (radiusM >= 160) return "M";
  return "S";
}

function temporalState(
  activeFrom: number | null,
  activeUntil: number | null,
  nowMs: number
): Pick<WorldZone, "lifecycle" | "isLive" | "startsInSeconds" | "endsInSeconds" | "isTemporary"> {
  const lifecycle: WorldZoneLifecycle =
    activeFrom !== null && nowMs < activeFrom
      ? "scheduled"
      : activeUntil !== null && nowMs >= activeUntil
        ? "expired"
        : "active";
  return {
    lifecycle,
    isLive: lifecycle === "active",
    startsInSeconds:
      lifecycle === "scheduled" && activeFrom !== null
        ? Math.max(0, Math.ceil((activeFrom - nowMs) / 1000))
        : null,
    endsInSeconds:
      lifecycle === "active" && activeUntil !== null
        ? Math.max(0, Math.ceil((activeUntil - nowMs) / 1000))
        : null,
    isTemporary: activeFrom !== null || activeUntil !== null
  };
}

function withinBbox(zone: Pick<CuratedZoneInput, "lng" | "lat" | "radiusM">, bbox: Bbox) {
  const latMargin = zone.radiusM / 111_320;
  const lngMargin =
    zone.radiusM /
    Math.max(111_320 * Math.cos((zone.lat * Math.PI) / 180), Math.max(zone.radiusM, 1));
  return (
    zone.lng + lngMargin >= bbox[0] &&
    zone.lng - lngMargin <= bbox[2] &&
    zone.lat + latMargin >= bbox[1] &&
    zone.lat - latMargin <= bbox[3]
  );
}

export function normalizeWorldZone(zone: CuratedZoneInput, now = new Date()): WorldZone {
  const nowMs = now.getTime();
  const from = dateValue(zone.activeFrom);
  const until = dateValue(zone.activeUntil);
  const kind = kindOf(zone.zoneKind);
  return {
    id: zone.id,
    name: zone.name,
    lng: zone.lng,
    lat: zone.lat,
    radiusM: zone.radiusM,
    description: zone.description ?? null,
    category: zone.category ?? null,
    lootTier:
      zone.lootTier ?? (kind === "event" ? "high" : kind === "staker_gate" ? "rare" : "medium"),
    zoneKind: kind,
    minStakeUsd: kind === "staker_gate" ? Math.max(10, zone.minStakeUsd ?? 0) : 0,
    activeFrom: from === null ? null : new Date(from).toISOString(),
    activeUntil: until === null ? null : new Date(until).toISOString(),
    ...temporalState(from, until, nowMs),
    sizeTier: sizeFor(zone.radiusM),
    eventTag: kind === "event" ? "live-event" : kind === "staker_gate" ? "staker-gate" : null
  };
}

function activeWindow(kind: WorldZoneKind, nowMs: number): { from: number; until: number } {
  const duration =
    kind === "standard" ? 24 * HOUR_MS : kind === "event" ? 4 * HOUR_MS : 8 * HOUR_MS;
  const from = Math.floor(nowMs / duration) * duration;
  return { from, until: from + duration };
}

/**
 * QuestLayer-style zones derived from real objectives. Every viewport gets all three gameplay
 * meanings, each with a bounded window. IDs include the UTC day, so the layout is stable during
 * play and naturally rotates with the daily board.
 */
export function deriveWorldZones(
  anchors: AnchoredQuest[],
  bbox: Bbox,
  now = new Date()
): WorldZone[] {
  const dayKey = now.toISOString().slice(0, 10);
  // One nearby zone per gameplay meaning keeps the map legible. More anchors still feed quests;
  // they do not need to become overlapping 200m rings as well.
  const count = 3;
  const centre = { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
  const nowMs = now.getTime();

  return Array.from({ length: count }, (_, index) => {
    const kind = KIND_ORDER[index % KIND_ORDER.length]!;
    const anchor = anchors.length ? anchors[index % anchors.length]! : null;
    const duplicateRound = anchors.length ? Math.floor(index / anchors.length) : index;
    const angle = index * 2.399963;
    const offsetM = duplicateRound ? 90 + duplicateRound * 35 : 0;
    const lat = (anchor?.lat ?? centre.lat) + (Math.sin(angle) * offsetM) / 111_320;
    const lng =
      (anchor?.lng ?? centre.lng) +
      (Math.cos(angle) * offsetM) /
        Math.max(111_320 * Math.cos((lat * Math.PI) / 180), Math.max(offsetM, 1));
    const window = activeWindow(kind, nowMs);
    const place = anchor?.anchorName ?? "okolí hráče";
    const name =
      kind === "event"
        ? `Událost · ${place}`
        : kind === "staker_gate"
          ? `Brána · ${place}`
          : `Průzkumná zóna · ${place}`;
    const radiusM = kind === "event" ? 180 : kind === "staker_gate" ? 140 : 120;

    return normalizeWorldZone(
      {
        id: `world-zone:${dayKey}:${kind}:${index}:${anchor?.id ?? "field"}`,
        name,
        lng,
        lat,
        radiusM,
        description:
          kind === "event"
            ? "Časově omezená událost s vyšší odměnou."
            : kind === "staker_gate"
              ? "Zóna s odměnou odemčenou pro aktivní stake."
              : "Denní průzkumná zóna navázaná na skutečné místo.",
        category: anchor?.kind ?? "exploration",
        lootTier: kind === "event" ? "high" : kind === "staker_gate" ? "rare" : "medium",
        zoneKind: kind,
        minStakeUsd: kind === "staker_gate" ? 10 : 0,
        activeFrom: new Date(window.from),
        activeUntil: new Date(window.until)
      },
      now
    );
  });
}

export function composeGameZones(
  curated: CuratedZoneInput[],
  anchors: AnchoredQuest[],
  bbox?: Bbox,
  now = new Date()
): WorldZone[] {
  const stored = curated
    .filter((zone) => !bbox || withinBbox(zone, bbox))
    .map((zone) => normalizeWorldZone(zone, now))
    .filter((zone) => zone.lifecycle !== "expired");
  const derived = bbox ? deriveWorldZones(anchors, bbox, now) : [];
  // Put the guaranteed type trio first so a compact HUD never hides the event or stake gate
  // behind several curated standard zones.
  return [...derived, ...stored];
}
