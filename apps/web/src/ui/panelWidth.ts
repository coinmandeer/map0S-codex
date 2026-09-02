export const LEFT_PANEL_WIDTH_STORAGE_KEY = "mapos:left-panel-width-v1";
export const LEFT_PANEL_DEFAULT_WIDTH = 380;
export const LEFT_PANEL_MIN_WIDTH = 320;
export const LEFT_PANEL_MAX_WIDTH = 560;
export const LEFT_PANEL_MAX_VIEWPORT_RATIO = 0.46;
export const LEFT_PANEL_KEYBOARD_STEP = 16;

export interface LeftPanelWidthBounds {
  min: number;
  max: number;
}

/** Keeps enough map visible at every supported desktop width. */
export function leftPanelWidthBounds(viewportWidth: number): LeftPanelWidthBounds {
  const ratioMaximum = Math.floor(viewportWidth * LEFT_PANEL_MAX_VIEWPORT_RATIO);
  return {
    min: LEFT_PANEL_MIN_WIDTH,
    max: Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, ratioMaximum))
  };
}

export function clampLeftPanelWidth(width: number, viewportWidth: number): number {
  const bounds = leftPanelWidthBounds(viewportWidth);
  const safeWidth = Number.isFinite(width) ? Math.round(width) : LEFT_PANEL_DEFAULT_WIDTH;
  return Math.min(bounds.max, Math.max(bounds.min, safeWidth));
}

export function readLeftPanelWidth(
  storage: Pick<Storage, "getItem"> | null,
  viewportWidth: number
): number {
  if (!storage) return clampLeftPanelWidth(LEFT_PANEL_DEFAULT_WIDTH, viewportWidth);
  try {
    const raw = storage.getItem(LEFT_PANEL_WIDTH_STORAGE_KEY);
    if (raw === null || raw.trim() === "") {
      return clampLeftPanelWidth(LEFT_PANEL_DEFAULT_WIDTH, viewportWidth);
    }
    const stored = Number(raw);
    return clampLeftPanelWidth(stored, viewportWidth);
  } catch {
    return clampLeftPanelWidth(LEFT_PANEL_DEFAULT_WIDTH, viewportWidth);
  }
}

export function writeLeftPanelWidth(storage: Pick<Storage, "setItem"> | null, width: number): void {
  if (!storage) return;
  try {
    storage.setItem(LEFT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // A blocked/full storage must not make the resize control unusable.
  }
}
