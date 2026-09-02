export type FocusRestoreTarget = Pick<HTMLElement, "focus" | "isConnected">;

export function captureFocusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** Restore only live elements; a trigger removed by a mode change must not steal focus. */
export function restoreFocus(target: FocusRestoreTarget | null): void {
  if (target?.isConnected) target.focus({ preventScroll: true });
}
