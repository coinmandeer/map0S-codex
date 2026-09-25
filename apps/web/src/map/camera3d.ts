import type maplibregl from "maplibre-gl";

/**
 * One place that decides how the ordinary (non-game) map camera behaves in 3D.
 *
 * Before this, each 3D toggle set its own pitch from inside its event handler. That had three
 * visible consequences: a reload with 3D saved came back flat (no toggle event fired), switching
 * buildings off flattened the camera even while terrain was still on, and the user could never
 * look around because rotation and tilt gestures stayed disabled in every mode.
 */

export interface Camera3dState {
  buildings3d: boolean;
  terrain3d: boolean;
  /** The drawn background carries building outlines; raster imagery does not. */
  canExtrude: boolean;
}

/** Extruded blocks need a steep view to read as blocks; relief reads from a gentler angle. */
export const BUILDINGS_PITCH = 55;
export const TERRAIN_PITCH = 45;
/** Buildings only draw from z14 and fade in until z16. */
export const BUILDINGS_MIN_VIEW_ZOOM = 15.5;

export function is3dActive(state: Camera3dState): boolean {
  return (state.buildings3d && state.canExtrude) || state.terrain3d;
}

/** The pitch the camera should settle at: the steepest any active 3D feature asks for. */
export function target3dPitch(state: Camera3dState): number {
  let pitch = 0;
  if (state.buildings3d && state.canExtrude) pitch = Math.max(pitch, BUILDINGS_PITCH);
  if (state.terrain3d) pitch = Math.max(pitch, TERRAIN_PITCH);
  return pitch;
}

/**
 * Rotation and tilt gestures follow 3D: a flat map stays predictable (no accidental rotation on
 * a trackpad), a 3D one can be looked around with right-drag / Ctrl-drag, two-finger twist and
 * the navigation control's compass and pitch indicator.
 */
export function set3dInteraction(map: maplibregl.Map, enabled: boolean): void {
  const toggle = (handler: { enable(): void; disable(): void } | undefined) => {
    if (!handler) return;
    if (enabled) handler.enable();
    else handler.disable();
  };
  toggle(map.dragRotate);
  toggle(map.touchPitch);
  const touch = map.touchZoomRotate as
    { enableRotation?(): void; disableRotation?(): void } | undefined;
  if (enabled) touch?.enableRotation?.();
  else touch?.disableRotation?.();
  const keyboard = map.keyboard as
    { enableRotation?(): void; disableRotation?(): void } | undefined;
  if (enabled) keyboard?.enableRotation?.();
  else keyboard?.disableRotation?.();
}
