import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

export type ModuleFailureKind = "chunk-load" | "render";

export function classifyModuleFailure(error: unknown): ModuleFailureKind {
  const summary =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return /ChunkLoadError|Loading chunk|dynamically imported module|module script failed/i.test(
    summary
  )
    ? "chunk-load"
    : "render";
}

const failureCounts = new Map<string, number>();

export interface ModuleErrorBoundaryProps {
  moduleId: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  resetKey?: unknown;
  placement?: "inline" | "panel" | "drawer" | "modal" | "overlay";
}

interface ModuleErrorBoundaryState {
  failed: boolean;
  failureKind: ModuleFailureKind | null;
  retryVersion: number;
}

/** Keeps a failed map extension/panel/game module from taking down the rest of the application. */
export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { failed: false, failureKind: null, retryVersion: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ModuleErrorBoundaryState> {
    return { failed: true, failureKind: classifyModuleFailure(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // Do not serialize the raw exception: provider payloads and private input can occur in it.
    const failureKind = classifyModuleFailure(error);
    const count = (failureCounts.get(this.props.moduleId) ?? 0) + 1;
    failureCounts.set(this.props.moduleId, count);
    console.error("MapOS module failed", {
      moduleId: this.props.moduleId,
      failureKind,
      count
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("mapos:module-error", {
          detail: { moduleId: this.props.moduleId, failureKind, count }
        })
      );
    }
  }

  componentDidUpdate(
    previousProps: ModuleErrorBoundaryProps,
    previousState: ModuleErrorBoundaryState
  ): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState((state) => ({
        failed: false,
        failureKind: null,
        retryVersion: state.retryVersion + 1
      }));
      return;
    }
    if (
      previousState.failed !== this.state.failed &&
      this.props.onDismiss &&
      typeof document !== "undefined"
    ) {
      if (this.state.failed) document.addEventListener("keydown", this.dismissOnEscape);
      else document.removeEventListener("keydown", this.dismissOnEscape);
    }
  }

  componentWillUnmount(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", this.dismissOnEscape);
    }
  }

  private dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.state.failed || !this.props.onDismiss) return;
    event.preventDefault();
    this.props.onDismiss();
  };

  private retry = () => {
    if (this.state.failureKind === "chunk-load" && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    this.setState((state) => ({
      failed: false,
      failureKind: null,
      retryVersion: state.retryVersion + 1
    }));
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.failed) {
      return <Fragment key={this.state.retryVersion}>{this.props.children}</Fragment>;
    }
    const placement = this.props.placement ?? "inline";
    return (
      <section
        className={`module-error-boundary is-${placement} ${this.props.compact ? "is-compact" : ""}`}
        role="alert"
        data-module-error={this.props.moduleId}
        data-failure-kind={this.state.failureKind}
      >
        <strong>{this.props.title}</strong>
        <p>Tahle část se nepodařila načíst. Ostatní mapa a nástroje zůstávají dostupné.</p>
        <div className="module-error-actions">
          <button className="btn" type="button" onClick={this.retry}>
            {this.state.failureKind === "chunk-load" ? "Obnovit aplikaci" : "Zkusit znovu"}
          </button>
          {this.props.onDismiss && (
            <button className="btn btn-ghost" type="button" onClick={this.props.onDismiss}>
              Zavřít tuto část
            </button>
          )}
        </div>
      </section>
    );
  }
}
