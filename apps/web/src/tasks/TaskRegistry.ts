import {
  MAPOS_V2_SCHEMA_VERSION,
  assertTaskRecordV2,
  type TaskCorrelationV2,
  type TaskErrorV2,
  type TaskRecordV2,
  type TaskTelemetryV2,
  type TaskTypeV2
} from "@mapos/layer-sdk";

const DEFAULT_MAX_RECORDS = 100;

export interface StartTaskInput {
  type: TaskTypeV2;
  label: string;
  layerId?: string | null;
  parentId?: string | null;
  requestKey?: string | null;
  cancellable?: boolean;
  message?: string | null;
  telemetry?: TaskTelemetryV2;
  correlation?: TaskCorrelationV2 | null;
  cancel?: () => void;
  retry?: () => void | Promise<void>;
}

export interface TaskFailureInput extends TaskErrorV2 {
  telemetry?: TaskTelemetryV2;
  correlation?: TaskCorrelationV2 | null;
}

interface RuntimeHooks {
  cancel?: () => void;
  retry?: () => void | Promise<void>;
}

export interface TaskRegistryOptions {
  now?: () => Date;
  id?: (type: TaskTypeV2) => string;
  maxRecords?: number;
}

const TERMINAL = new Set<TaskRecordV2["status"]>(["succeeded", "failed", "cancelled", "stale"]);

function copyTask(task: TaskRecordV2): TaskRecordV2 {
  return {
    ...task,
    ...(task.error ? { error: { ...task.error } } : {}),
    ...(task.telemetry ? { telemetry: { ...task.telemetry } } : {}),
    ...(task.correlation ? { correlation: { ...task.correlation } } : {})
  };
}

/**
 * One typed registry for layer queries, routing, AI and future background work.
 * Runtime callbacks stay outside serialisable task records so snapshots can safely cross UI and
 * telemetry boundaries.
 */
export class TaskRegistry {
  private readonly records = new Map<string, TaskRecordV2>();
  private readonly hooks = new Map<string, RuntimeHooks>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;
  private readonly id: (type: TaskTypeV2) => string;
  private readonly maxRecords: number;
  private sequence = 0;
  private revisionValue = 0;

  constructor(options: TaskRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.id =
      options.id ??
      ((type) => `task:${type}:${this.now().getTime().toString(36)}:${++this.sequence}`);
    this.maxRecords = Math.max(1, options.maxRecords ?? DEFAULT_MAX_RECORDS);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision = (): number => this.revisionValue;

  snapshot(): TaskRecordV2[] {
    return [...this.records.values()]
      .map(copyTask)
      .sort(
        (left, right) =>
          right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id)
      );
  }

  active(): TaskRecordV2[] {
    return this.snapshot().filter((task) => !TERMINAL.has(task.status));
  }

  get(taskId: string): TaskRecordV2 | undefined {
    const task = this.records.get(taskId);
    return task ? copyTask(task) : undefined;
  }

  start(input: StartTaskInput): TaskRecordV2 {
    const task: TaskRecordV2 = {
      schema: "mapos.task",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      id: this.id(input.type),
      type: input.type,
      label: input.label,
      status: "running",
      progress: null,
      message: input.message ?? null,
      layerId: input.layerId ?? null,
      parentId: input.parentId ?? null,
      requestKey: input.requestKey ?? null,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      cancellable: Boolean(input.cancellable && input.cancel),
      error: null,
      telemetry: { ...(input.telemetry ?? {}) },
      ...(input.correlation !== undefined ? { correlation: input.correlation } : {})
    };
    assertTaskRecordV2(task);
    this.records.set(task.id, task);
    this.hooks.set(task.id, { cancel: input.cancel, retry: input.retry });
    this.prune();
    this.emit();
    return copyTask(task);
  }

  progress(taskId: string, progress: number | null, message?: string | null): boolean {
    const task = this.records.get(taskId);
    if (!task || TERMINAL.has(task.status)) return false;
    if (progress != null && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
      throw new RangeError("Task progress must be between 0 and 1.");
    }
    task.progress = progress;
    if (message !== undefined) task.message = message;
    this.emit();
    return true;
  }

  succeed(
    taskId: string,
    telemetry: TaskTelemetryV2 = {},
    correlation?: TaskCorrelationV2 | null
  ): boolean {
    return this.finish(taskId, "succeeded", { telemetry, correlation });
  }

  fail(taskId: string, failure: TaskFailureInput): boolean {
    return this.finish(taskId, "failed", {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable
      },
      message: failure.message,
      telemetry: failure.telemetry,
      correlation: failure.correlation
    });
  }

  markStale(taskId: string, message = "Nahrazeno novějším požadavkem"): boolean {
    return this.finish(taskId, "stale", { message });
  }

  cancel(taskId: string): boolean {
    const task = this.records.get(taskId);
    if (!task || TERMINAL.has(task.status) || !task.cancellable) return false;
    const cancel = this.hooks.get(taskId)?.cancel;
    this.finish(taskId, "cancelled", { message: "Zrušeno" });
    cancel?.();
    return true;
  }

  retry(taskId: string): boolean {
    const task = this.records.get(taskId);
    const retry = this.hooks.get(taskId)?.retry;
    if (task?.status !== "failed" || !task.error?.retryable || !retry) return false;
    // Run the replacement after the current pointer/click event has completed. A retry commonly
    // retires this record and starts another one; doing that synchronously would detach the action
    // button while its own interaction is still being dispatched.
    void Promise.resolve().then(retry);
    return true;
  }

  canRetry(taskId: string): boolean {
    const task = this.records.get(taskId);
    return Boolean(
      task?.status === "failed" && task.error?.retryable && this.hooks.get(taskId)?.retry
    );
  }

  dismiss(taskId: string): boolean {
    const task = this.records.get(taskId);
    if (!task || !TERMINAL.has(task.status)) return false;
    this.records.delete(taskId);
    this.hooks.delete(taskId);
    this.emit();
    return true;
  }

  reset(): void {
    this.records.clear();
    this.hooks.clear();
    this.emit();
  }

  private finish(
    taskId: string,
    status: Extract<TaskRecordV2["status"], "succeeded" | "failed" | "cancelled" | "stale">,
    patch: {
      message?: string | null;
      error?: TaskErrorV2 | null;
      telemetry?: TaskTelemetryV2;
      correlation?: TaskCorrelationV2 | null;
    }
  ): boolean {
    const task = this.records.get(taskId);
    if (!task || TERMINAL.has(task.status)) return false;
    const finishedAt = this.now().toISOString();
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(task.startedAt));
    const next: TaskRecordV2 = {
      ...task,
      status,
      finishedAt,
      progress: status === "succeeded" ? 1 : task.progress,
      ...(patch.message !== undefined ? { message: patch.message } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      telemetry: {
        ...task.telemetry,
        ...patch.telemetry,
        durationMs,
        ...(status === "cancelled" ? { aborted: true } : {})
      },
      ...(patch.correlation !== undefined ? { correlation: patch.correlation } : {})
    };
    assertTaskRecordV2(next);
    this.records.set(taskId, next);
    this.prune();
    this.emit();
    return true;
  }

  private prune(): void {
    if (this.records.size <= this.maxRecords) return;
    for (const [id, task] of this.records) {
      if (!TERMINAL.has(task.status)) continue;
      this.records.delete(id);
      this.hooks.delete(id);
      if (this.records.size <= this.maxRecords) break;
    }
  }

  private emit(): void {
    this.revisionValue += 1;
    for (const listener of this.listeners) listener();
  }
}

export const taskRegistry = new TaskRegistry();
