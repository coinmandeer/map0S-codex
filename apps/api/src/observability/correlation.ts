import { AsyncLocalStorage } from "node:async_hooks";

interface CorrelationContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithRequestCorrelation<T>(requestId: string, callback: () => T): T {
  return storage.run({ requestId }, callback);
}

/**
 * Enters the request's existing async resource before Fastify advances from `onRequest` to later
 * lifecycle hooks and the route handler. Wrapping only the `done` callback in `run()` is not
 * sufficient: Fastify may resume a continuation that was registered before that callback, which
 * loses the store before an upstream request is started.
 */
export function enterRequestCorrelation(requestId: string): void {
  storage.enterWith({ requestId });
}

export function currentRequestCorrelationId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
