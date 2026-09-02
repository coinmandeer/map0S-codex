export type LatestRequestResult<T> =
  | { status: "applied"; requestId: number; value: T }
  | { status: "stale"; requestId: number }
  | { status: "cancelled"; requestId: number; reason: string };

export type LatestRequestExecutor<T> = (signal: AbortSignal) => Promise<T>;

interface ActiveRequest {
  id: number;
  controller: AbortController;
  cancelReason?: string;
}

function abortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (!!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError")
  );
}

/**
 * Owns one request slot. Starting a request aborts its predecessor and a predecessor that ignores
 * AbortSignal is still marked stale, so its late response can never reach the apply callback.
 */
export class LatestRequestRunner<T> {
  private nextRequestId = 0;
  private active?: ActiveRequest;
  private disposed = false;

  get pending(): boolean {
    return this.active !== undefined;
  }

  async run(
    executor: LatestRequestExecutor<T>,
    apply?: (value: T) => void
  ): Promise<LatestRequestResult<T>> {
    if (this.disposed) {
      return { status: "cancelled", requestId: this.nextRequestId, reason: "disposed" };
    }

    if (this.active) {
      this.active.cancelReason = "superseded";
      this.active.controller.abort("superseded");
    }
    const request: ActiveRequest = {
      id: ++this.nextRequestId,
      controller: new AbortController()
    };
    this.active = request;

    let value: T;
    try {
      value = await executor(request.controller.signal);
    } catch (error) {
      if (this.active?.id !== request.id) return { status: "stale", requestId: request.id };
      this.active = undefined;
      if (request.controller.signal.aborted || abortError(error)) {
        return {
          status: "cancelled",
          requestId: request.id,
          reason: request.cancelReason ?? "cancelled"
        };
      }
      throw error;
    }
    if (this.active?.id !== request.id) return { status: "stale", requestId: request.id };
    if (request.controller.signal.aborted) {
      this.active = undefined;
      return {
        status: "cancelled",
        requestId: request.id,
        reason: request.cancelReason ?? "cancelled"
      };
    }
    this.active = undefined;
    apply?.(value);
    return { status: "applied", requestId: request.id, value };
  }

  cancel(reason = "cancelled"): boolean {
    if (!this.active || this.active.controller.signal.aborted) return false;
    this.active.cancelReason = reason;
    this.active.controller.abort(reason);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("disposed");
  }
}
