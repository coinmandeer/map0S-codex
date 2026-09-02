import { useSyncExternalStore } from "react";
import { getShellStore, type ShellState } from "./shellStore";

export function useShellStoreSnapshot<T>(selector: (state: ShellState) => T): T {
  const store = getShellStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => selector(store.snapshot),
    () => selector(store.snapshot)
  );
}
