import type { TaskRecordV2, TaskTypeV2 } from "@mapos/layer-sdk";
import type { IconName } from "../kit/icons";

/** Newest first, and never more than this many rows on screen at once. Concurrency is capped
 *  at four by the task registry, so a taller stack would only ever show queue noise. */
export const ACTIVITY_MAX_ROWS = 3;

export type ActivityTone = "running" | "done" | "error";

export interface ActivityRow {
  id: string;
  label: string;
  detail?: string;
  tone: ActivityTone;
  icon: IconName;
  /** 0–1 when the task reports it, otherwise undefined for an indeterminate bar. */
  progress?: number;
  layerId?: string;
}

const TYPE_ICONS: Record<TaskTypeV2, IconName> = {
  "layer-query": "layers",
  "tile-load": "map",
  geocode: "search",
  "reverse-geocode": "place",
  routing: "route",
  weather: "cloud",
  "event-search": "event",
  ai: "auto_awesome",
  "poi-enrichment": "info",
  import: "upload",
  export: "download",
  sync: "sync",
  "game-asset": "stadia_controller",
  commerce: "payments"
};

function rowFor(task: TaskRecordV2): ActivityRow {
  const failed = task.status === "failed";
  const done = task.status === "succeeded";
  return {
    id: task.id,
    label: task.label,
    detail: failed ? (task.error?.message ?? undefined) : (task.message ?? undefined),
    tone: failed ? "error" : done ? "done" : "running",
    icon: failed ? "error" : done ? "check" : TYPE_ICONS[task.type],
    progress: task.progress ?? undefined,
    layerId: task.layerId ?? undefined
  };
}

function startedAtMs(task: TaskRecordV2): number {
  const parsed = Date.parse(task.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Turns the task registry into the rows of the activity pill (§4.12).
 *
 *  `settledIds` are tasks that finished recently enough to still deserve a line — the caller
 *  owns those timers, because "how long does a tick stay visible" is a presentation decision
 *  and not something the registry should have to model.
 */
export function activityRows(
  tasks: readonly TaskRecordV2[],
  settledIds: ReadonlySet<string>
): ActivityRow[] {
  const relevant = tasks.filter((task) => {
    if (task.status === "queued" || task.status === "running") return true;
    return settledIds.has(task.id);
  });
  return relevant
    .slice()
    .sort((a, b) => {
      // Failures first: they are the only rows the user has to act on.
      const aFailed = a.status === "failed" ? 1 : 0;
      const bFailed = b.status === "failed" ? 1 : 0;
      if (aFailed !== bFailed) return bFailed - aFailed;
      return startedAtMs(b) - startedAtMs(a);
    })
    .slice(0, ACTIVITY_MAX_ROWS)
    .map(rowFor);
}

/** Single-line summary shown when the pill is collapsed. */
export function activitySummary(rows: readonly ActivityRow[]): string | null {
  if (!rows.length) return null;
  const failed = rows.filter((row) => row.tone === "error");
  if (failed.length) {
    return failed.length === 1 ? failed[0]!.label : `${failed.length} chyby při načítání`;
  }
  const running = rows.filter((row) => row.tone === "running");
  if (!running.length) return rows[0]!.label;
  return running.length === 1 ? running[0]!.label : `${running.length} úlohy běží`;
}
