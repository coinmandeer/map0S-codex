import { hasDismissibleSurface } from "./shellState";
import type { ShellStore } from "./shellStore";

export interface ShellHistoryPort {
  pushGuard(): void;
  back(): void;
  listen(listener: () => void): () => void;
}

/**
 * Keeps one same-document history guard in front of the page while a shell surface is open.
 * Browser/Android back consumes that guard and asks the pure shell reducer to dismiss one level.
 * If another level remains, a fresh guard is installed for the next back press.
 */
export class ShellBrowserHistoryBinding {
  private guardActive = false;
  private suppressNextPop = false;
  private readonly unsubscribeStore: () => void;
  private readonly unsubscribePop: () => void;

  constructor(
    private readonly shell: ShellStore,
    private readonly port: ShellHistoryPort
  ) {
    this.unsubscribeStore = shell.subscribe(() => this.syncGuard());
    this.unsubscribePop = port.listen(() => this.onPop());
    this.syncGuard();
  }

  private syncGuard(): void {
    const dismissible = hasDismissibleSurface(this.shell.snapshot);
    if (dismissible && !this.guardActive) {
      this.port.pushGuard();
      this.guardActive = true;
      return;
    }
    if (!dismissible && this.guardActive) {
      this.guardActive = false;
      this.suppressNextPop = true;
      this.port.back();
    }
  }

  private onPop(): void {
    if (this.suppressNextPop) {
      this.suppressNextPop = false;
      return;
    }
    if (!this.guardActive) return;
    this.guardActive = false;
    this.shell.back();
  }

  dispose(): void {
    this.unsubscribeStore();
    this.unsubscribePop();
  }
}

const SHELL_HISTORY_KEY = "__maposShellGuard";

export function windowShellHistoryPort(): ShellHistoryPort | null {
  if (typeof window === "undefined") return null;
  return {
    pushGuard() {
      const current =
        window.history.state && typeof window.history.state === "object"
          ? (window.history.state as Record<string, unknown>)
          : {};
      window.history.pushState(
        { ...current, [SHELL_HISTORY_KEY]: true },
        document.title,
        window.location.href
      );
    },
    back() {
      window.history.back();
    },
    listen(listener) {
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    }
  };
}
