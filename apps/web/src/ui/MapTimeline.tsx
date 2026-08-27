import type { ReactNode } from "react";

/**
 * The strip anchored above the map.
 *
 * Weather and events both need one, and they need the same one: the same clearance above the
 * bottom nav, the same width on a phone, the same backdrop. What differs is only the control
 * inside — a single-value scrubber over radar frames, a two-handle range over dates.
 */
export function MapTimeline({
  children,
  testId,
  wide = false
}: {
  children: ReactNode;
  testId?: string;
  /** Events need more room than the radar scrubber, since presets and a histogram stack up. */
  wide?: boolean;
}) {
  return (
    <div className={`map-timeline${wide ? " wide" : ""}`} data-testid={testId}>
      {children}
    </div>
  );
}
