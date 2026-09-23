import {
  assertOverviewEvent,
  type OverviewEvent,
  type OverviewRequest,
  type OverviewResult
} from "@mapos/layer-sdk";
import { bootstrapGuestSession } from "../../lib/sessionBootstrap";
import { getMapStore } from "../../store/mapStore";
import { apiPostEventStream } from "../../lib/api";
import { on } from "../../lib/events";
export interface OverviewState {
  snapshot?: OverviewResult;
  phase: string;
  busy: boolean;
  error?: string;
}
export class OverviewSession {
  state: OverviewState = { phase: "", busy: false };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private generation = 0;
  private seq = 0;
  private runId?: string;
  private fingerprint?: string;
  private disposal?: ReturnType<typeof setTimeout>;
  constructor(readonly input: OverviewRequest) {}
  subscribe = (listener: () => void) => {
    if (this.disposal) clearTimeout(this.disposal);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      // A synchronous StrictMode re-subscription cancels disposal.
      if (!this.listeners.size) this.disposal = setTimeout(() => this.stop(), 50);
    };
  };
  snapshot = () => this.state;
  private update(value: OverviewState) {
    this.state = value;
    this.listeners.forEach((listener) => listener());
  }
  hydrate(snapshot: OverviewResult) {
    if (!this.state.busy)
      this.update({ snapshot, phase: "Uložený přehled · informace mohou být starší", busy: false });
  }
  stop() {
    if (!this.state.busy) return;
    this.generation++;
    this.controller?.abort();
    this.update({ ...this.state, busy: false, phase: "Zastaveno · získané údaje zůstávají" });
  }
  async start(refresh = false) {
    if (this.state.busy) return;
    this.controller?.abort();
    const generation = ++this.generation;
    this.controller = new AbortController();
    this.seq = 0;
    this.runId = undefined;
    this.fingerprint = undefined;
    this.update({ ...this.state, busy: true, error: undefined, phase: "Načítám ověřené podklady" });
    let terminal = false;
    try {
      if (!getMapStore().session) await bootstrapGuestSession(this.controller.signal);
      if (generation !== this.generation) return;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(this.input.target))
      );
      const expectedTarget = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      if (generation !== this.generation) return;
      await apiPostEventStream<OverviewEvent>(
        "/v2/ai/overview",
        { ...this.input, refresh },
        (raw) => {
          if (generation !== this.generation) return;
          assertOverviewEvent(raw);
          if (raw.targetKey !== expectedTarget) throw new Error("Odpověď patří jinému místu.");
          if (this.runId && (raw.runId !== this.runId || raw.scopeFingerprint !== this.fingerprint))
            throw new Error("Odpověď patří jinému kontextu.");
          if (raw.seq <= this.seq) return;
          this.seq = raw.seq;
          this.runId = raw.runId;
          this.fingerprint = raw.scopeFingerprint;
          terminal = [
            "complete",
            "partial",
            "insufficient_evidence",
            "cancelled",
            "error"
          ].includes(raw.type);
          this.update({
            snapshot: raw.snapshot,
            busy: !terminal,
            phase: raw.phase ?? (terminal ? "" : this.state.phase)
          });
        },
        {
          auth: true,
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)])
        }
      );
      if (!terminal && generation === this.generation)
        throw new Error("Přenos se přerušil. Zobrazuji získanou část.");
    } catch (error) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          busy: false,
          phase: "",
          error: error instanceof Error ? error.message : "Přehled nelze dokončit."
        });
    }
  }
  clear() {
    this.stop();
    this.generation++;
    this.update({ phase: "", busy: false });
  }
}
const sessions = new Map<string, OverviewSession>();
export function overviewSession(input: OverviewRequest) {
  const key = JSON.stringify(input);
  let session = sessions.get(key);
  if (!session) {
    session = new OverviewSession(input);
    sessions.set(key, session);
    // Bounded memory, never evict active work.
    if (sessions.size > 40)
      for (const [oldKey, old] of sessions) {
        if (oldKey !== key && !old.state.busy) {
          sessions.delete(oldKey);
          break;
        }
      }
  }
  return session;
}
let owner: string | null | undefined;
on("session-changed", (event) => {
  if (owner === undefined) {
    owner = event.userId;
    return;
  }
  if (owner !== event.userId) {
    owner = event.userId;
    sessions.forEach((session) => session.clear());
    sessions.clear();
  }
});
