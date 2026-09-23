/** Each consumer owns its wait, while transport belongs to all remaining consumers. */
export interface SharedRequest<T> {
  promise: Promise<T>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}
export function consumeShared<T>(entry: SharedRequest<T>, signal?: AbortSignal): Promise<T> {
  entry.consumers++;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, value?: T) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", abort);
      entry.consumers--;
      if (!entry.consumers && !entry.settled)
        entry.controller.abort(new DOMException("No remaining consumers", "AbortError"));
      if (error !== undefined) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    entry.promise.then(
      (value) => finish(undefined, value),
      (error) => finish(error)
    );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
