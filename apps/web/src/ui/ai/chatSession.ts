import { isMapResultArtifact } from "@mapos/layer-sdk";
import { isConversationWorkspace } from "./workspaceValidation";
import { apiGet, apiSend } from "../../lib/api";
import {
  captureWorkspace,
  restoreWorkspace,
  clearConversationResults,
  type ConversationWorkspace
} from "./mapScene";
import { useSyncExternalStore } from "react";
import { on } from "../../lib/events";
import { getMapStore } from "../../store/mapStore";
import type { Turn } from "./chatTypes";

export interface ConversationSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  archived?: boolean;
}
interface State {
  includeArchived: boolean;
  archived: boolean;
  sessions: ConversationSummary[];
  nextHistoryCursor: string | null;
  historyError: string | null;
  prompt: string;
  turns: Turn[];
  busy: boolean;
  conversationId: string | null;
  revision: number;
}
const initial = (): State => ({
  includeArchived: false,
  archived: false,
  sessions: [],
  nextHistoryCursor: null,
  historyError: null,
  prompt: "",
  turns: [],
  busy: false,
  conversationId: null,
  revision: 0
});
/** Shell-owned session. Component unmount (including a place excursion) is not a new thread. */
export class ChatSession {
  state = initial();
  generation = 0;
  askedSeed: string | null = null;
  undoMap: (() => void) | null = null;
  running: { current: AbortController | null } = { current: null };
  private listeners = new Set<() => void>();
  private owner: string | null | undefined;
  setOwner(userId: string | null) {
    // Authenticated requests use the cookie before bootstrap resolves, including guest cookies.
    const changed = this.owner !== undefined && this.owner !== userId;
    this.owner = userId;
    if (changed) {
      this.clear();
      this.set("sessions", []);
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set<K extends keyof State>(key: K, value: State[K] | ((old: State[K]) => State[K])) {
    this.state = {
      ...this.state,
      [key]: typeof value === "function" ? value(this.state[key]) : value
    };
    this.listeners.forEach((listener) => listener());
  }
  stop() {
    this.running.current?.abort();
  }
  async refreshHistory(append = false) {
    const owner = this.owner;
    try {
      const cursor = append ? this.state.nextHistoryCursor : null;
      if (append && !cursor) return;
      const result = await apiGet<{
        conversations: ConversationSummary[];
        nextCursor?: string | null;
      }>(
        `/v2/ai/conversations?archived=${this.state.includeArchived ? "1" : "0"}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        {
          auth: true
        }
      );
      if (owner !== this.owner) return;
      this.set(
        "sessions",
        append
          ? [
              ...new Map(
                [...this.state.sessions, ...result.conversations].map((s) => [s.id, s])
              ).values()
            ]
          : result.conversations
      );
      this.set("nextHistoryCursor", result.nextCursor ?? null);
      this.set("historyError", null);
    } catch {
      if (owner === this.owner) this.set("historyError", "Historii se nepodařilo načíst.");
    }
  }
  async openConversation(id: string) {
    this.stop();
    this.set("busy", true);
    const generation = ++this.generation;
    try {
      const result = await apiGet<{
        id: string;
        revision: number;
        turns: Turn[];
        archived?: boolean;
        workspace: ConversationWorkspace | null;
      }>(`/v2/ai/conversations/${encodeURIComponent(id)}`, { auth: true });
      if (generation !== this.generation) return;
      this.state = {
        ...initial(),
        sessions: this.state.sessions,
        nextHistoryCursor: this.state.nextHistoryCursor,
        conversationId: result.id,
        includeArchived: this.state.includeArchived,
        archived: result.archived ?? false,
        busy: true,
        revision: result.revision,
        turns: result.turns.map((t) => ({
          ...t,
          done: true,
          step: null,
          error: t.done ? t.error : "Přerušená odpověď"
        }))
      };
      clearConversationResults();
      if (result.workspace) {
        if (isConversationWorkspace(result.workspace)) {
          const workspace = result.workspace;
          if (workspace.artifactIds?.length) {
            const restored = await Promise.all(
              workspace.artifactIds.map(async (artifactId) => {
                try {
                  const artifact = await apiGet<unknown>(
                    `/v2/ai/artifacts/${encodeURIComponent(artifactId)}`,
                    { auth: true }
                  );
                  return isMapResultArtifact(artifact) &&
                    artifact.id === artifactId &&
                    artifact.conversationId === result.id
                    ? artifact
                    : null;
                } catch {
                  return null;
                }
              })
            );
            if (generation !== this.generation) return;
            workspace.artifacts = restored.filter((a): a is NonNullable<typeof a> => a !== null);
            if (restored.some((a) => a === null))
              this.state.historyError = "Část uložených mapových výsledků není dostupná.";
          }
          restoreWorkspace(workspace);
        } else
          this.state.historyError = "Historie je načtená, ale uložený mapový pohled není platný.";
      }
      this.undoMap = null;
      this.listeners.forEach((listener) => listener());
    } catch {
      if (generation === this.generation)
        this.set("historyError", "Konverzaci se nepodařilo otevřít.");
    } finally {
      if (generation === this.generation) this.set("busy", false);
    }
  }
  async saveWorkspace(refresh = true) {
    const id = this.state.conversationId;
    if (!id) return;
    const workspace = captureWorkspace();
    const { artifacts, ...scene } = workspace;
    await apiSend(
      "PATCH",
      `/v2/ai/conversations/${encodeURIComponent(id)}`,
      {
        workspace: { ...scene, artifactIds: (artifacts ?? []).map((a) => a.id) },
        baseRevision: this.state.revision
      },
      { auth: true }
    );
    if (refresh) await this.refreshHistory();
  }
  async renameConversation(title: string) {
    const id = this.state.conversationId,
      owner = this.owner;
    const name = title.trim().slice(0, 120);
    if (!id || !name || this.state.busy) return;
    try {
      await apiSend(
        "PATCH",
        `/v2/ai/conversations/${encodeURIComponent(id)}`,
        { title: name },
        { auth: true }
      );
      if (owner === this.owner) await this.refreshHistory();
    } catch {
      if (owner === this.owner) this.set("historyError", "Název konverzace se nepodařilo uložit.");
    }
  }
  async archiveConversation(archived: boolean) {
    const id = this.state.conversationId,
      owner = this.owner;
    if (!id || this.state.busy) return;
    try {
      await apiSend(
        "PATCH",
        `/v2/ai/conversations/${encodeURIComponent(id)}`,
        { archived },
        { auth: true }
      );
      if (owner !== this.owner) return;
      if (this.state.conversationId === id) this.set("archived", archived);
      if (archived) this.set("includeArchived", true);
      await this.refreshHistory();
    } catch {
      if (owner === this.owner)
        this.set("historyError", "Archivaci konverzace se nepodařilo změnit.");
    }
  }
  async deleteConversation() {
    const id = this.state.conversationId,
      owner = this.owner;
    if (!id || this.state.busy) return;
    try {
      await apiSend("DELETE", `/v2/ai/conversations/${encodeURIComponent(id)}`, undefined, {
        auth: true
      });
      if (owner !== this.owner) return;
      if (this.state.conversationId === id) this.clear();
      await this.refreshHistory();
    } catch {
      if (owner === this.owner) this.set("historyError", "Konverzaci se nepodařilo smazat.");
    }
  }
  clear() {
    if (typeof window !== "undefined") clearConversationResults();
    this.generation++;
    this.stop();
    this.running.current = null;
    this.askedSeed = null;
    this.undoMap = null;
    this.state = { ...initial(), sessions: this.state.sessions };
    this.listeners.forEach((listener) => listener());
  }
}
export const chatSession = new ChatSession();
on("session-changed", (event) => chatSession.setOwner(event.userId));
// The shell owns this subscription, so closing the panel preserves subsequent map edits too.
// Serialize saves and coalesce notifications; stale generations never save into another session.
if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let lastSaved = "";
  let lastFailed = "";
  const schedule = () => {
    clearTimeout(timer);
    const generation = chatSession.generation;
    timer = setTimeout(async () => {
      if (saving) {
        schedule();
        return;
      }
      if (
        generation !== chatSession.generation ||
        chatSession.state.busy ||
        !chatSession.state.conversationId
      )
        return;
      const fingerprint = JSON.stringify([
        chatSession.state.conversationId,
        chatSession.state.revision,
        captureWorkspace()
      ]);
      if (fingerprint === lastSaved || fingerprint === lastFailed) return;
      saving = true;
      try {
        await chatSession.saveWorkspace(false);
        lastSaved = fingerprint;
        lastFailed = "";
      } catch {
        lastFailed = fingerprint;
        if (generation === chatSession.generation)
          chatSession.set("historyError", "Poslední změny mapy se nepodařilo uložit do historie.");
      } finally {
        saving = false;
      }
    }, 600);
  };
  getMapStore().subscribe(schedule);
  chatSession.subscribe(schedule);
}
export function useChatField<K extends keyof State>(
  key: K
): [State[K], (value: State[K] | ((old: State[K]) => State[K])) => void] {
  const value = useSyncExternalStore(chatSession.subscribe, () => chatSession.state[key]);
  return [value, (next) => chatSession.set(key, next)];
}
