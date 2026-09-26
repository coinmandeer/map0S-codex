import { useCallback, useSyncExternalStore } from "react";
import { getShellStore, type ShellState } from "./shellStore";

export function useShellStoreSnapshot<T>(selector: (state: ShellState) => T): T {
  const store = getShellStore();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(
    subscribe,
    () => selector(store.snapshot),
    () => selector(store.snapshot)
  );
}
