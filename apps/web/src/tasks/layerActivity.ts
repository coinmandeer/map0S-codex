import { presentationLabel } from "../i18n/presentation";
export type LayerPhase =
  | "queued"
  | "loading"
  | "rendering"
  | "ready"
  | "empty"
  | "partial"
  | "error"
  | "pending"
  | "zoom"
  | "coverage"
  | "budget"
  | "off";
export interface LayerActivity {
  generation: number;
  phase: LayerPhase;
  count?: number;
  unit?: "places" | "tiles" | "samples";
  message?: string;
  durationMs?: number;
  cache?: boolean;
  transferredBytes?: number;
  updatedAt: number;
  startedAt: number;
}
const records = new Map<string, LayerActivity>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
let revision = 0;
function publish() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    revision++;
    for (const fn of listeners) fn();
  }, 120);
}
export const layerActivity = {
  revision: () => revision,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get(id: string) {
    return records.get(id);
  },
  begin(id: string, phase: LayerPhase = "queued") {
    const generation = ++sequence;
    records.set(id, { generation, phase, startedAt: Date.now(), updatedAt: Date.now() });
    while (records.size > 200) records.delete(records.keys().next().value!);
    publish();
    return generation;
  },
  patch(id: string, generation: number, patch: Partial<LayerActivity>) {
    const previous = records.get(id);
    if (!previous || previous.generation !== generation) return;
    records.set(id, { ...previous, ...patch, generation, updatedAt: Date.now() });
    publish();
  },
  state(id: string, phase: LayerPhase, message?: string) {
    const generation = this.begin(id, phase);
    this.patch(id, generation, { message });
  }
};
export function activityLabel(state?: LayerActivity): string {
  return state?.message && !/^\d+$/.test(state.message)
    ? state.message
    : presentationLabel("phase", state?.phase ?? "queued");
}

export function mapActivitySummary(states: (LayerActivity | undefined)[]): string {
  const busy = states.filter(
    (state) => state && ["queued", "loading", "rendering"].includes(state.phase)
  ).length;
  const problems = states.filter(
    (state) => state && ["error", "partial", "budget"].includes(state.phase)
  ).length;
  if (busy) return `Načítám ${busy} vrstev${problems ? " · některé zdroje nejsou dostupné" : ""}`;
  if (problems) return "Některé vrstvy nejsou dostupné nebo jsou neúplné";
  if (states.some((state) => state?.phase === "pending"))
    return "Některé vrstvy čekají na Hledat zde";
  if (states.some((state) => !state || ["zoom", "coverage"].includes(state.phase)))
    return "Některé vrstvy se v tomto výřezu nezobrazují";
  return "Mapa je aktuální";
}
