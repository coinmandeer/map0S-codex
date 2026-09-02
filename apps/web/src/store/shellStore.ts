import { resolveAppMode, type AppModeInput } from "../product/registry";
import type {
  MapPickerCancelReason,
  MapPickerLocation,
  MapPickerResult,
  MapPickerSession,
  OpenMapPickerInput
} from "../search/mapPicker";
import { mapPickerControllers } from "./mapPickerRuntime";
import { getMapStore, type SheetType } from "./mapStore";
import {
  createShellState,
  modalForLegacySheet,
  rightUtilityForLegacySheet,
  shellReducer,
  type FooterContributionState,
  type LeftContext,
  type LegacyModalSheet,
  type RightUtility,
  type ShellAction,
  type ShellState
} from "./shellState";

export type {
  FooterContributionState,
  LeftContext,
  LegacyModalSheet,
  MapPickerState,
  ModalState,
  RightUtility,
  ShellState,
  ShellSurfaceSnapshot
} from "./shellState";

type Listener = () => void;

export interface ShellSource {
  readonly mode: ShellState["mode"];
  readonly sidebarOpen: boolean;
  readonly sheet: SheetType;
  subscribe(listener: Listener): () => void;
  setMode(mode: AppModeInput): void;
  setSidebarOpen(open: boolean): void;
  togglePanel(): void;
  openSheet(sheet: SheetType): void;
  closeSheet(): void;
}

export type StartMapPickerInput = OpenMapPickerInput;

function sourceLeftContext(source: ShellSource): LeftContext {
  return source.sidebarOpen ? { type: "mode", mode: source.mode } : { type: "closed" };
}

function sourceSignature(source: ShellSource): string {
  return `${source.mode}|${source.sidebarOpen ? "1" : "0"}|${source.sheet ?? ""}`;
}

/**
 * Compatibility facade and the canonical serializable shell state machine.
 *
 * MapStore remains the source for mode and legacy callers during the strangler migration. New
 * surfaces live here, while every transition is mirrored back to the old fields so either side
 * can be used without mounting a second map or creating a second navigation truth.
 */
export class ShellStore {
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeSource: () => void;
  private readonly footerRegistrations = new Map<string, number>();
  private applyingToSource = false;
  private lastSourceSignature: string;
  private current: ShellState;

  constructor(private readonly source: ShellSource) {
    this.current = createShellState({
      mode: source.mode,
      leftContext: sourceLeftContext(source),
      legacySheet: source.sheet
    });
    this.lastSourceSignature = sourceSignature(source);
    this.unsubscribeSource = source.subscribe(() => this.syncFromSource());
  }

  get snapshot(): ShellState {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private dispatch(action: ShellAction, reconcileSource = false): void {
    const next = shellReducer(this.current, action);
    if (next === this.current) return;
    this.current = next;
    if (reconcileSource) this.reconcileSource();
    this.notify();
  }

  private syncFromSource(): void {
    const signature = sourceSignature(this.source);
    if (this.applyingToSource || signature === this.lastSourceSignature) return;
    this.lastSourceSignature = signature;
    this.dispatch({
      type: "source-sync",
      mode: this.source.mode,
      leftContext: sourceLeftContext(this.source),
      legacySheet: this.source.sheet
    });
  }

  private reconcileSource(modeInput?: AppModeInput): void {
    this.applyingToSource = true;
    try {
      if (modeInput !== undefined) this.source.setMode(modeInput);
      else if (this.source.mode !== this.current.mode) this.source.setMode(this.current.mode);

      const leftOpen = this.current.leftContext.type !== "closed";
      if (this.source.sidebarOpen !== leftOpen) this.source.setSidebarOpen(leftOpen);

      if (this.source.sheet !== this.current.legacySheet) {
        if (this.current.legacySheet) this.source.openSheet(this.current.legacySheet);
        else this.source.closeSheet();
      }
    } finally {
      this.applyingToSource = false;
      this.lastSourceSignature = sourceSignature(this.source);
    }
  }

  setMode(input: AppModeInput): void {
    const { mode } = resolveAppMode(input);
    this.dispatch({ type: "set-mode", mode, openLeft: true });
    // Always pass the original input once: aliases can carry additive migration behavior
    // (`weather` activates its layer) even when their canonical mode is already selected.
    this.reconcileSource(input);
  }

  openLeftContext(context?: Exclude<LeftContext, { type: "closed" }>): void {
    this.dispatch({ type: "open-left", context }, true);
  }

  closeLeftContext(): void {
    this.dispatch({ type: "close-left" }, true);
  }

  toggleLeftContext(): void {
    if (this.current.leftContext.type === "closed") this.openLeftContext();
    else this.closeLeftContext();
  }

  openRightUtility(
    utility: Exclude<RightUtility, { type: "closed" }> | RightUtility["type"]
  ): void {
    const value = typeof utility === "string" ? utility : utility.type;
    if (value === "closed") {
      this.closeRightUtility();
      return;
    }
    this.dispatch({ type: "open-right", utility: { type: value } }, true);
  }

  closeRightUtility(): void {
    this.dispatch({ type: "close-right" }, true);
  }

  openModal(sheet: LegacyModalSheet): void {
    this.dispatch({ type: "open-modal", sheet }, true);
  }

  closeModal(): void {
    this.dispatch({ type: "close-modal" }, true);
  }

  startMapPicker(
    input: StartMapPickerInput,
    callback: (result: MapPickerResult) => void = () => {}
  ): string {
    const session = mapPickerControllers.open(input, callback);
    this.dispatch({ type: "start-map-picker", session });
    return session.id;
  }

  attachMapPicker(
    session: MapPickerSession,
    callback: (result: MapPickerResult) => void = () => {}
  ): void {
    const attached = mapPickerControllers.attach(session, callback);
    this.dispatch({ type: "start-map-picker", session: attached });
  }

  updateMapPickerCandidate(candidate: MapPickerLocation): void {
    if (this.current.mapPicker.type !== "active") return;
    const session = mapPickerControllers.updateCandidate(
      this.current.mapPicker.session.id,
      candidate
    );
    if (session) this.dispatch({ type: "update-map-picker", session });
  }

  closeMapPicker(reason: MapPickerCancelReason = "caller"): void {
    if (this.current.mapPicker.type === "active") {
      mapPickerControllers.cancel(this.current.mapPicker.session.id, reason);
    }
    this.dispatch({ type: "close-map-picker" });
  }

  registerFooterContribution(contribution: FooterContributionState): () => void {
    this.footerRegistrations.set(
      contribution.id,
      (this.footerRegistrations.get(contribution.id) ?? 0) + 1
    );
    this.dispatch({ type: "register-footer", contribution });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const remaining = (this.footerRegistrations.get(contribution.id) ?? 1) - 1;
      if (remaining > 0) {
        this.footerRegistrations.set(contribution.id, remaining);
        return;
      }
      this.footerRegistrations.delete(contribution.id);
      this.dispatch({ type: "unregister-footer", id: contribution.id });
    };
  }

  /** Restores the last surface snapshot, then falls back to closing the topmost open surface. */
  back(): boolean {
    const before = this.current;
    this.dispatch({ type: "back" }, true);
    if (before.mapPicker.type === "active" && this.current.mapPicker.type === "closed") {
      mapPickerControllers.cancel(before.mapPicker.session.id, "user");
    }
    return before !== this.current;
  }

  openLegacySheet(sheet: Exclude<SheetType, null>): void {
    const right = rightUtilityForLegacySheet(sheet);
    if (right && right.type !== "closed") {
      this.openRightUtility(right);
      return;
    }
    const modal = modalForLegacySheet(sheet);
    if (modal?.type === "legacy") this.openModal(modal.sheet);
  }

  closeLegacySheet(): void {
    if (this.current.modal.type !== "closed") this.closeModal();
    else if (
      this.current.rightUtility.type === "settings" ||
      this.current.rightUtility.type === "basemaps"
    )
      this.closeRightUtility();
    else {
      this.applyingToSource = true;
      try {
        this.source.closeSheet();
      } finally {
        this.applyingToSource = false;
        this.lastSourceSignature = sourceSignature(this.source);
      }
    }
  }

  dispose(): void {
    this.unsubscribeSource();
    this.listeners.clear();
    this.footerRegistrations.clear();
  }
}

let shellStoreInstance: ShellStore | null = null;

export function getShellStore(): ShellStore {
  if (!shellStoreInstance) shellStoreInstance = new ShellStore(getMapStore());
  return shellStoreInstance;
}
