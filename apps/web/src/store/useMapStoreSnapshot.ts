import { useSyncExternalStore } from "react";
import type { MapStore } from "./mapStore";
import { getMapStore } from "./mapStore";

export function useMapStoreSnapshot<T>(selector: (s: MapStore) => T): T {
  const store = getMapStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => selector(store),
    () => selector(store)
  );
}
