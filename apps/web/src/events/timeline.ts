import type { GeoFeature } from "@mapos/layer-sdk";

export const EVENT_YEAR_DAYS = 365;
export const EVENT_DETAIL_DAYS = 90;
export const EVENT_TIMELINE_MAX = 1_000;
export const EVENT_DETAIL_TRACK_END = 650;
export const EVENT_TIMELINE_COMMIT_DELAY_MS = 200;
export const EVENT_HISTOGRAM_BUCKETS = 52;
const DAY_MS = 86_400_000;

export type EventRangePresetId = "today" | "weekend" | "week" | "month" | "three-months" | "year";

export interface EventRangePreset {
  id: EventRangePresetId;
  label: string;
  range: [number, number];
}

function clampDay(value: number): number {
  return Math.min(EVENT_YEAR_DAYS, Math.max(0, value));
}

export function dayToEventTimelinePosition(day: number): number {
  const bounded = clampDay(day);
  if (bounded <= EVENT_DETAIL_DAYS) {
    return (bounded / EVENT_DETAIL_DAYS) * EVENT_DETAIL_TRACK_END;
  }
  return (
    EVENT_DETAIL_TRACK_END +
    ((bounded - EVENT_DETAIL_DAYS) / (EVENT_YEAR_DAYS - EVENT_DETAIL_DAYS)) *
      (EVENT_TIMELINE_MAX - EVENT_DETAIL_TRACK_END)
  );
}

export function eventTimelinePositionToDay(position: number): number {
  const bounded = Math.min(EVENT_TIMELINE_MAX, Math.max(0, position));
  if (bounded <= EVENT_DETAIL_TRACK_END) {
    return Math.round((bounded / EVENT_DETAIL_TRACK_END) * EVENT_DETAIL_DAYS);
  }
  return Math.round(
    EVENT_DETAIL_DAYS +
      ((bounded - EVENT_DETAIL_TRACK_END) / (EVENT_TIMELINE_MAX - EVENT_DETAIL_TRACK_END)) *
        (EVENT_YEAR_DAYS - EVENT_DETAIL_DAYS)
  );
}

export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function eventDateAtDay(day: number, base = new Date()): Date {
  return new Date(startOfLocalDay(base).getTime() + clampDay(day) * DAY_MS);
}

export function eventFilterPatch(
  range: [number, number],
  base = new Date()
): { from: string; to: string } {
  const from = eventDateAtDay(range[0], base);
  const to = new Date(eventDateAtDay(range[1], base).getTime() + DAY_MS - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function eventRangeFromFilters(
  filters: Record<string, unknown>,
  base = new Date()
): [number, number] {
  const today = startOfLocalDay(base).getTime();
  const from = typeof filters.from === "string" ? Date.parse(filters.from) : Number.NaN;
  const to = typeof filters.to === "string" ? Date.parse(filters.to) : Number.NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [0, 7];
  return [
    clampDay(Math.floor((from - today) / DAY_MS)),
    clampDay(Math.floor((to - today) / DAY_MS))
  ];
}

export function eventRangePresets(base = new Date()): EventRangePreset[] {
  const weekday = startOfLocalDay(base).getDay();
  const toSaturday = weekday === 0 ? 0 : 6 - weekday;
  return [
    { id: "today", label: "Dnes", range: [0, 0] },
    {
      id: "weekend",
      label: "Víkend",
      range: [toSaturday, toSaturday + (weekday === 0 ? 0 : 1)]
    },
    { id: "week", label: "Týden", range: [0, 7] },
    { id: "month", label: "Měsíc", range: [0, 30] },
    { id: "three-months", label: "3 měsíce", range: [0, 90] },
    { id: "year", label: "Rok", range: [0, EVENT_YEAR_DAYS] }
  ];
}

export function eventFeatureStart(feature: GeoFeature): string | null {
  const startsAt = feature.properties.startsAt ?? feature.properties.occurredAt;
  return typeof startsAt === "string" && !Number.isNaN(Date.parse(startsAt)) ? startsAt : null;
}

export function buildEventHistogram(
  features: readonly GeoFeature[],
  base = new Date(),
  buckets = EVENT_HISTOGRAM_BUCKETS
): number[] {
  const result = new Array<number>(Math.max(1, buckets)).fill(0);
  const start = startOfLocalDay(base).getTime();
  for (const feature of features) {
    const value = eventFeatureStart(feature);
    if (!value) continue;
    const day = Math.floor((Date.parse(value) - start) / DAY_MS);
    if (day < 0 || day > EVENT_YEAR_DAYS) continue;
    const position = dayToEventTimelinePosition(day);
    const index = Math.min(
      result.length - 1,
      Math.floor((position / EVENT_TIMELINE_MAX) * result.length)
    );
    result[index] = (result[index] ?? 0) + 1;
  }
  return result;
}

export function eventFilterPatchChanges(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): boolean {
  return Object.entries(patch).some(([key, value]) => !Object.is(current[key], value));
}
