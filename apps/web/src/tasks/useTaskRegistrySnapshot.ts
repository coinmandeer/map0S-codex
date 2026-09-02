import { useSyncExternalStore } from "react";
import type { TaskRecordV2 } from "@mapos/layer-sdk";
import { taskRegistry } from "./TaskRegistry";

export function useTaskRegistrySnapshot<T>(selector: (tasks: TaskRecordV2[]) => T): T {
  useSyncExternalStore(
    (listener) => taskRegistry.subscribe(listener),
    taskRegistry.getRevision,
    taskRegistry.getRevision
  );
  return selector(taskRegistry.snapshot());
}
