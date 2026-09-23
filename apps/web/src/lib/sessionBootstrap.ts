import { apiPost } from "./api";
import type { UserSession } from "../store/mapStore";

let pending: Promise<{ user: UserSession }> | null = null;

/** React StrictMode mounts effects twice in development. Coalescing the boot request prevents
 * those two effects from creating two guest accounts before either response can set a cookie. */
export function bootstrapGuestSession(signal?: AbortSignal): Promise<{ user: UserSession }> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (!pending) {
    pending = apiPost<{ user: UserSession }>("/auth/guest");
    void pending.then(undefined, () => {
      pending = null;
    });
  }
  if (!signal) return pending;
  // The shell still needs this shared request if a chat subscriber presses Stop.
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      action();
    };
    const abort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error("Připojení relace trvá příliš dlouho. Zkuste otázku znovu."))
        ),
      8000
    );
    signal.addEventListener("abort", abort, { once: true });
    pending!.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}
