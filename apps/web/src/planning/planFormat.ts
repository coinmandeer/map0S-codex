import { formatDistance as formatDistanceValue } from "../lib/units";
import type { DistanceUnits } from "../settings/preferences";
import { intlLocale } from "../i18n";

/** Formatting shared by the planning panel's rows, footer and assistant.
 *
 *  Kept out of the components so a segment row and the footer total can never disagree about
 *  how long "3 h 40 min" is written. */

export function formatDistance(metres: number, units: DistanceUnits): string {
  return formatDistanceValue(metres, units);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function formatDistanceDelta(metres: number, units: DistanceUnits): string {
  if (Math.abs(metres) < 50) return "stejná délka";
  const sign = metres > 0 ? "+" : "−";
  return `${sign}${formatDistance(Math.abs(metres), units)}`;
}

export function formatDurationDelta(seconds: number): string {
  if (Math.abs(seconds) < 30) return "stejný čas";
  const sign = seconds > 0 ? "+" : "−";
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

export function formatPlanTime(value: string | null | undefined): string {
  if (!value) return "čas není dostupný";
  return new Date(value).toLocaleString(intlLocale(), {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** `datetime-local` wants wall-clock text, not an instant. */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The one-line recap the collapsed "Více možností" header shows, so a set departure or
 *  vehicle is visible without opening the section. */
export function planOptionsSummary(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}
