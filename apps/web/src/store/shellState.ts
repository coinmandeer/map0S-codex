import type { AppMode } from "../product/registry";
import type { MapPickerSession } from "../search/mapPicker";
import type { SheetType } from "./mapStore";

export type LeftContext =
  | { type: "closed" }
  | { type: "mode"; mode: AppMode }
  | {
      type: "feature";
      featureRef: { layerId: string; featureId: string };
      returnTo?: Exclude<LeftContext, { type: "feature" }>;
    };

export type RightUtility =
  { type: "closed" } | { type: "layers" } | { type: "basemaps" } | { type: "settings" };

export type LegacyModalSheet = Exclude<SheetType, "settings" | "basemap" | "tiles" | null>;

export type ModalState = { type: "closed" } | { type: "legacy"; sheet: LegacyModalSheet };

export type MapPickerState = { type: "closed" } | { type: "active"; session: MapPickerSession };

export interface FooterContributionState {
  id: string;
  kind: "timeline" | "legend" | "route" | "status" | "custom";
  /** Larger values render first. The id is the deterministic tie breaker. */
  priority: number;
}

export interface ShellSurfaceSnapshot {
  mode: AppMode;
  leftContext: LeftContext;
  rightUtility: RightUtility;
  modal: ModalState;
  mapPicker: MapPickerState;
  legacySheet: SheetType;
}

export interface ShellState extends ShellSurfaceSnapshot {
  footerContributions: FooterContributionState[];
  /** Serializable surface snapshots used by Escape/browser-back. */
  history: ShellSurfaceSnapshot[];
}

export type ShellAction =
  | { type: "set-mode"; mode: AppMode; openLeft: boolean }
  | { type: "open-left"; context?: Exclude<LeftContext, { type: "closed" }> }
  | { type: "close-left" }
  | { type: "open-right"; utility: Exclude<RightUtility, { type: "closed" }> }
  | { type: "close-right" }
  | { type: "open-modal"; sheet: LegacyModalSheet }
  | { type: "close-modal" }
  | { type: "start-map-picker"; session: MapPickerSession }
  | { type: "update-map-picker"; session: MapPickerSession }
  | { type: "close-map-picker" }
  | { type: "register-footer"; contribution: FooterContributionState }
  | { type: "unregister-footer"; id: string }
  | { type: "back" }
  | {
      type: "source-sync";
      mode: AppMode;
      leftContext: LeftContext;
      legacySheet: SheetType;
    };

export function rightUtilityForLegacySheet(sheet: SheetType): RightUtility | null {
  if (sheet === "settings") return { type: "settings" };
  if (sheet === "basemap" || sheet === "tiles") return { type: "basemaps" };
  return null;
}

export function modalForLegacySheet(sheet: SheetType): ModalState | null {
  if (
    sheet === "pin" ||
    sheet === "auth" ||
    sheet === "edit" ||
    sheet === "route" ||
    sheet === "wizard"
  )
    return { type: "legacy", sheet };
  return null;
}

function legacySheetFor(rightUtility: RightUtility, modal: ModalState): SheetType {
  if (modal.type === "legacy") return modal.sheet;
  if (rightUtility.type === "settings") return "settings";
  if (rightUtility.type === "basemaps") return "tiles";
  return null;
}

export function createShellState(input: {
  mode: AppMode;
  leftContext: LeftContext;
  legacySheet: SheetType;
}): ShellState {
  return {
    mode: input.mode,
    leftContext: input.leftContext,
    rightUtility: rightUtilityForLegacySheet(input.legacySheet) ?? { type: "closed" },
    modal: modalForLegacySheet(input.legacySheet) ?? { type: "closed" },
    mapPicker: { type: "closed" },
    legacySheet: input.legacySheet,
    footerContributions: [],
    history: []
  };
}

function snapshotOf(state: ShellState): ShellSurfaceSnapshot {
  return {
    mode: state.mode,
    leftContext: state.leftContext,
    rightUtility: state.rightUtility,
    modal: state.modal,
    mapPicker: state.mapPicker,
    legacySheet: state.legacySheet
  };
}

function sameSurface(a: ShellSurfaceSnapshot, b: ShellSurfaceSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withSurfaceHistory(state: ShellState, patch: Partial<ShellSurfaceSnapshot>): ShellState {
  const next = { ...state, ...patch };
  next.legacySheet = legacySheetFor(next.rightUtility, next.modal);
  if (sameSurface(snapshotOf(state), snapshotOf(next))) return state;
  return { ...next, history: [...state.history, snapshotOf(state)] };
}

type SurfaceKey = "leftContext" | "rightUtility" | "modal" | "mapPicker";

function scrubClosedSurface(
  history: ShellSurfaceSnapshot[],
  key: SurfaceKey
): ShellSurfaceSnapshot[] {
  const closed = { type: "closed" } as const;
  return history.map((entry) => {
    const next = { ...entry, [key]: closed } as ShellSurfaceSnapshot;
    next.legacySheet = legacySheetFor(next.rightUtility, next.modal);
    return next;
  });
}

function closeSurface(state: ShellState, key: SurfaceKey): ShellState {
  if (state[key].type === "closed") return state;
  const next = { ...state, [key]: { type: "closed" } } as ShellState;
  next.legacySheet = legacySheetFor(next.rightUtility, next.modal);
  next.history = scrubClosedSurface(state.history, key);
  return next;
}

function sortedFooterContributions(values: FooterContributionState[]): FooterContributionState[] {
  return [...values].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function sourceSyncedState(
  state: ShellState,
  action: Extract<ShellAction, { type: "source-sync" }>
): ShellState {
  const nextRight = rightUtilityForLegacySheet(action.legacySheet);
  const nextModal = modalForLegacySheet(action.legacySheet);
  let rightUtility = state.rightUtility;
  let modal: ModalState;

  if (nextRight) {
    rightUtility = nextRight;
    modal = { type: "closed" };
  } else if (nextModal) {
    modal = nextModal;
    // Layers are an independent utility and may remain behind a modal. The two legacy utilities
    // share MapStore's one sheet slot, so they cannot remain open when that slot becomes a modal.
    if (rightUtility.type === "settings" || rightUtility.type === "basemaps") {
      rightUtility = { type: "closed" };
    }
  } else {
    modal = { type: "closed" };
    if (rightUtility.type === "settings" || rightUtility.type === "basemaps") {
      rightUtility = { type: "closed" };
    }
  }

  return {
    ...state,
    mode: action.mode,
    leftContext: action.leftContext,
    rightUtility,
    modal,
    legacySheet: action.legacySheet
  };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "set-mode":
      return withSurfaceHistory(state, {
        mode: action.mode,
        leftContext: action.openLeft ? { type: "mode", mode: action.mode } : { type: "closed" }
      });
    case "open-left":
      return withSurfaceHistory(state, {
        leftContext: action.context ?? { type: "mode", mode: state.mode }
      });
    case "close-left":
      return closeSurface(state, "leftContext");
    case "open-right": {
      const modal =
        action.utility.type === "layers" || state.modal.type === "closed"
          ? state.modal
          : ({ type: "closed" } as const);
      return withSurfaceHistory(state, { rightUtility: action.utility, modal });
    }
    case "close-right":
      return closeSurface(state, "rightUtility");
    case "open-modal": {
      const rightUtility =
        state.rightUtility.type === "layers" ? state.rightUtility : ({ type: "closed" } as const);
      return withSurfaceHistory(state, {
        modal: { type: "legacy", sheet: action.sheet },
        rightUtility
      });
    }
    case "close-modal":
      return closeSurface(state, "modal");
    case "start-map-picker":
      return withSurfaceHistory(state, { mapPicker: { type: "active", session: action.session } });
    case "update-map-picker":
      if (state.mapPicker.type !== "active") return state;
      if (state.mapPicker.session === action.session) return state;
      return { ...state, mapPicker: { type: "active", session: action.session } };
    case "close-map-picker":
      return closeSurface(state, "mapPicker");
    case "register-footer": {
      const current = state.footerContributions.find(
        (contribution) => contribution.id === action.contribution.id
      );
      if (
        current?.kind === action.contribution.kind &&
        current.priority === action.contribution.priority
      )
        return state;
      return {
        ...state,
        footerContributions: sortedFooterContributions([
          ...state.footerContributions.filter(
            (contribution) => contribution.id !== action.contribution.id
          ),
          action.contribution
        ])
      };
    }
    case "unregister-footer": {
      const footerContributions = state.footerContributions.filter(
        (contribution) => contribution.id !== action.id
      );
      return footerContributions.length === state.footerContributions.length
        ? state
        : { ...state, footerContributions };
    }
    case "source-sync":
      return sourceSyncedState(state, action);
    case "back": {
      let history = state.history;
      while (history.length) {
        const previous = history[history.length - 1]!;
        history = history.slice(0, -1);
        if (!sameSurface(snapshotOf(state), previous)) {
          return { ...state, ...previous, history };
        }
      }
      if (state.mapPicker.type !== "closed") return closeSurface(state, "mapPicker");
      if (state.modal.type !== "closed") return closeSurface(state, "modal");
      if (state.rightUtility.type !== "closed") return closeSurface(state, "rightUtility");
      if (state.leftContext.type !== "closed") return closeSurface(state, "leftContext");
      return state;
    }
  }
}

export function hasDismissibleSurface(state: ShellState): boolean {
  return (
    state.mapPicker.type !== "closed" ||
    state.modal.type !== "closed" ||
    state.rightUtility.type !== "closed" ||
    state.leftContext.type !== "closed"
  );
}
