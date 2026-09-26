import { useCallback, useSyncExternalStore } from "react";
import type { MapStore } from "./mapStore";
import { getMapStore } from "./mapStore";

export function useMapStoreSnapshot<T>(selector: (s: MapStore) => T): T {
  const store = getMapStore();
  // A new subscribe function each render made React unsubscribe and resubscribe every component
  // on every render; one per store keeps the subscription.
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  return useSyncExternalStore(
    subscribe,
    () => selector(store),
    () => selector(store)
  );
}
