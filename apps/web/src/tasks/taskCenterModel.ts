import type { TaskRecordV2, TaskTypeV2 } from "@mapos/layer-sdk";

const ACTIVE_STATUSES = new Set<TaskRecordV2["status"]>(["queued", "running"]);

const TYPE_LABELS: Record<TaskTypeV2, string> = {
  "layer-query": "Piny a místa",
  "tile-load": "Mapový podklad",
  geocode: "Hledání adresy",
  "reverse-geocode": "Určení místa",
  routing: "Výpočet trasy",
  weather: "Počasí",
  "event-search": "Události",
  ai: "AI zpracování",
  "poi-enrichment": "Detail místa",
  import: "Import dat",
  export: "Export dat",
  sync: "Synchronizace",
  "game-asset": "Herní data",
  commerce: "Platba"
};

export interface TaskCenterModel {
  active: TaskRecordV2[];
  failed: TaskRecordV2[];
  entries: TaskRecordV2[];
  compactLabel: string;
  hasFailure: boolean;
}

export function taskTypeLabel(type: TaskTypeV2): string {
  return TYPE_LABELS[type];
}

export function taskCenterModel(tasks: TaskRecordV2[], maxEntries = 8): TaskCenterModel {
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const failed = tasks.filter((task) => task.status === "failed");
  const entries = [...active, ...failed].slice(0, Math.max(1, maxEntries));
  const compactLabel =
    active.length === 1
      ? active[0]!.label
      : active.length > 1
        ? `${active.length} souběžné úlohy`
        : failed.length === 1
          ? "1 úloha vyžaduje pozornost"
          : `${failed.length} úlohy vyžadují pozornost`;
  return { active, failed, entries, compactLabel, hasFailure: failed.length > 0 };
}

export function taskProgressLabel(task: TaskRecordV2): string {
  if (task.status === "failed") return "Chyba";
  if (task.status === "queued") return "Čeká";
  if (task.progress != null) return `${Math.round(task.progress * 100)} %`;
  return "Probíhá";
}
