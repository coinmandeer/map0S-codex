/** Mobile bottom-sheet snap points (§21.2).
 *
 *  `full` deliberately does not mean "the whole screen": a 112 px strip of map stays above the
 *  sheet, and the map pans its target into that strip when the user picks a row. A sheet that
 *  covered everything would make the map a thing you leave rather than a thing you browse.
 */
export const PANEL_SNAPS = ["peek", "half", "full"] as const;

export type PanelSnap = (typeof PANEL_SNAPS)[number];

/** Bare peek: handle, title and a one-line summary or action row. */
export const PEEK_HEIGHT_PX = 96;
/** Map strip kept visible above a full sheet. */
export const MAP_STRIP_PX = 112;

const STORAGE_PREFIX = "mapos:panel-snap:";

export function snapIndex(snap: PanelSnap): number {
  return PANEL_SNAPS.indexOf(snap);
}

export function snapAt(index: number): PanelSnap {
  return PANEL_SNAPS[Math.min(PANEL_SNAPS.length - 1, Math.max(0, index))]!;
}

/** Height in px of a snap, given the viewport and the chrome above and below the sheet. */
export function snapHeightPx(
  snap: PanelSnap,
  layout: { viewportHeight: number; topBarBottom: number; bottomNavHeight: number }
): number {
  if (snap === "peek") return PEEK_HEIGHT_PX;
  const available =
    layout.viewportHeight - layout.topBarBottom - MAP_STRIP_PX - layout.bottomNavHeight;
  if (snap === "full") return Math.max(PEEK_HEIGHT_PX, available);
  return Math.max(PEEK_HEIGHT_PX, Math.min(available, layout.viewportHeight * 0.5));
}

/** Nearest snap to a dragged height, so releasing the finger always lands on one of the three. */
export function nearestSnap(
  heightPx: number,
  layout: { viewportHeight: number; topBarBottom: number; bottomNavHeight: number }
): PanelSnap {
  let best: PanelSnap = "half";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const snap of PANEL_SNAPS) {
    const delta = Math.abs(snapHeightPx(snap, layout) - heightPx);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = snap;
    }
  }
  return best;
}

/** Panels that open on a list of things start fully open; the ones that open on an empty form
 *  or a single record start half open so the map stays in view (§21.2). */
export function defaultSnapFor(panelId: string, hasContent: boolean): PanelSnap {
  if (panelId === "place-detail") return "half";
  if (panelId === "planning-panel") return hasContent ? "full" : "half";
  return "full";
}

export function readSnap(storage: Storage | null, panelId: string): PanelSnap | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${panelId}`);
    return PANEL_SNAPS.includes(raw as PanelSnap) ? (raw as PanelSnap) : null;
  } catch {
    return null;
  }
}

export function writeSnap(storage: Storage | null, panelId: string, snap: PanelSnap): void {
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${panelId}`, snap);
  } catch {
    // A full or blocked sessionStorage only costs the remembered height.
  }
}
