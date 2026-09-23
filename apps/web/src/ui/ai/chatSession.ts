import { useSyncExternalStore } from "react";
import { on } from "../../lib/events";
import type { Turn } from "./chatTypes";

interface State {
  prompt: string;
  turns: Turn[];
  busy: boolean;
  conversationId: string | null;
  revision: number;
}
const initial = (): State => ({
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
  running: { current: AbortController | null } = { current: null };
  private listeners = new Set<() => void>();
  private owner: string | null | undefined;
  setOwner(userId: string | null) {
    // Authenticated requests use the cookie before bootstrap resolves, including guest cookies.
    const changed = this.owner !== undefined && this.owner !== userId;
    this.owner = userId;
    if (changed) this.clear();
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
  clear() {
    this.generation++;
    this.stop();
    this.running.current = null;
    this.askedSeed = null;
    this.state = initial();
    this.listeners.forEach((listener) => listener());
  }
}
export const chatSession = new ChatSession();
on("session-changed", (event) => chatSession.setOwner(event.userId));
export function useChatField<K extends keyof State>(
  key: K
): [State[K], (value: State[K] | ((old: State[K]) => State[K])) => void] {
  const value = useSyncExternalStore(chatSession.subscribe, () => chatSession.state[key]);
  return [value, (next) => chatSession.set(key, next)];
}
