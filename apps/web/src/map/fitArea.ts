import type { Map } from "maplibre-gl";
import { chromeMapPadding, readChromeInsets } from "./chromePadding";

/** Frame the complete area in the space left by panels, including a little context. */
export function fitArea(
  map: Map,
  bbox: readonly number[],
  options: { maxZoom?: number; animate?: boolean } = {}
) {
  const canvas = map.getContainer();
  const padding = chromeMapPadding(readChromeInsets(), {
    width: canvas.clientWidth,
    height: canvas.clientHeight
  });
  const horizontal = Math.max(0, canvas.clientWidth - padding.left - padding.right);
  const vertical = Math.max(0, canvas.clientHeight - padding.top - padding.bottom);
  const x = Math.min(horizontal * 0.15, Math.max(24, horizontal * 0.08));
  const y = Math.min(vertical * 0.15, Math.max(24, vertical * 0.08));
  // MapLibre adds fitBounds padding to the camera's existing chrome padding.
  // Reserve only the missing insets and context, otherwise a mobile sheet is counted twice.
  const current = map.getPadding();
  map.fitBounds(
    [
      [bbox[0]!, bbox[1]!],
      [bbox[2]!, bbox[3]!]
    ],
    {
      padding: {
        left: Math.max(0, padding.left - (current.left ?? 0)) + x,
        right: Math.max(0, padding.right - (current.right ?? 0)) + x,
        top: Math.max(0, padding.top - (current.top ?? 0)) + y,
        bottom: Math.max(0, padding.bottom - (current.bottom ?? 0)) + y
      },
      pitch: 0,
      maxZoom: options.maxZoom ?? 17,
      duration:
        options.animate !== false && !matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 550
          : 0
    }
  );
}
