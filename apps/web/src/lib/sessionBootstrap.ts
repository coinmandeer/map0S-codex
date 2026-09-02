import { apiPost } from "./api";
import type { UserSession } from "../store/mapStore";

let pending: Promise<{ user: UserSession }> | null = null;

/** React StrictMode mounts effects twice in development. Coalescing the boot request prevents
 * those two effects from creating two guest accounts before either response can set a cookie. */
export function bootstrapGuestSession(): Promise<{ user: UserSession }> {
  if (!pending) {
    pending = apiPost<{ user: UserSession }>("/auth/guest");
    void pending.then(undefined, () => {
      pending = null;
    });
  }
  return pending;
}
